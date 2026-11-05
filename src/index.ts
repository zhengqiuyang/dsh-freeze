/**
 * dsh-freeze — hermetic composition lock for DeepSeek Harness.
 *
 * "Today's agent composition is byte-identical to the one you reviewed."
 * Fingerprints the booted profile: installed dependencies (name-sorted),
 * the ordered bundle composition, the pnpm lockfile hash, and the user
 * patch layer. First boot baselines; every later boot compares and says
 * loudly what moved. `strict: true` fails the plugin (and the boot) — the
 * --frozen posture for CI. Zero LLM calls in the trust path.
 *
 * Family: ... mcp-test (what agents can call) · prompt-drift (what they are
 * told) · **freeze (what exactly they are running)**.
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { diffFingerprints, fingerprintProfile, type ProfileFingerprint } from './fingerprint.js';

export const name = 'dsh-freeze';

export interface Config {
  /** Baseline file; commit or back it up — it is the frozen contract. */
  baselinePath: string;
  /** Fail the plugin (and boot) on drift — the --frozen posture for CI. */
  strict: boolean;
  /** Profile to fingerprint; empty = auto-detect from argv (--profile / web). */
  profile: string;
}

export const Config: Schema<Config> = Schema.object({
  baselinePath: Schema.string().default('.dsh-freeze/baseline.json').description('baseline file with the frozen fingerprint'),
  strict: Schema.boolean().default(false).description('fail the boot on drift instead of warning (CI posture)'),
  profile: Schema.string().default('').description("profile name; empty auto-detects from argv (--profile, else 'web')"),
});

/** Extracted for tests: how the plugin decides which profile it runs in. */
export function detectProfileName(argv: readonly string[]): string {
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === '--profile') return argv[i + 1] ?? '';
    const m = /^--profile=(.+)$/.exec(argv[i] ?? '');
    if (m) return m[1];
  }
  return 'web';
}

export function profileDirFor(profile: string, envHome: string | undefined, home: string): string {
  const root = envHome && envHome.length > 0 ? envHome : join(home, '.dsh');
  return join(root, 'profiles', profile);
}

export type BaselineLoad =
  | { status: 'absent' }
  | { status: 'unreadable'; error: string }
  | { status: 'malformed'; error: string }
  | { status: 'ok'; value: ProfileFingerprint };

export async function loadBaseline(path: string): Promise<BaselineLoad> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? '';
    if (code === 'ENOENT') return { status: 'absent' };
    return { status: 'unreadable', error: code || (e as Error).message.slice(0, 60) };
  }
  try {
    const parsed = JSON.parse(text) as ProfileFingerprint;
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.fingerprint !== 'string') {
      return { status: 'malformed', error: 'missing fingerprint field' };
    }
    return { status: 'ok', value: parsed };
  } catch (e) {
    return { status: 'malformed', error: (e as Error).message.slice(0, 60) };
  }
}

export async function apply(ctx: Context, config: Config) {
  const profile = config.profile !== '' ? config.profile : detectProfileName(process.argv);
  const dir = profileDirFor(profile, process.env.DSH_HOME, homedir());

  if (!existsSync(join(dir, 'package.json'))) {
    console.warn(`[dsh-freeze] no profile dir at ${dir} — freeze gate idle`);
    return;
  }
  const current = await fingerprintProfile(dir);
  const loaded = await loadBaseline(config.baselinePath);
  if (loaded.status === 'absent') {
    await mkdir(join(config.baselinePath, '..'), { recursive: true }).catch(() => {});
    await writeFile(config.baselinePath, JSON.stringify({ profile, ...current }, null, 2) + '\n', 'utf8');
    console.log(
      `[dsh-freeze] baseline frozen: profile '${profile}', ${Object.keys(current.dependencies).length} package(s), ` +
        `bundles=${current.bundles.length} -> ${config.baselinePath}`,
    );
    return;
  }
  if (loaded.status !== 'ok') {
    // A damaged or unreadable baseline must never be silently overwritten —
    // that would reset trust-on-first-use for a composition nobody approved.
    const detail = loaded.status === 'unreadable' ? `unreadable (${loaded.error})` : `malformed JSON (${loaded.error})`;
    const message =
      `[dsh-freeze] baseline at ${config.baselinePath} is ${detail}. ` +
      `Refusing to overwrite — inspect the file, then delete it deliberately to re-baseline.`;
    if (config.strict) {
      // Throwing from async apply fails plugin activation — the --frozen posture.
      throw new Error(message);
    }
    console.warn(`[dsh-freeze] ${message}`);
    return;
  }
  const baseline = loaded.value;
  const diff = diffFingerprints(baseline, current);
  if (diff.ok) {
    console.log(`[dsh-freeze] composition matches baseline (${current.fingerprint.slice(0, 16)}…)`);
    return;
  }
  const message =
    `[dsh-freeze] COMPOSITION DRIFT in profile '${profile}': ${diff.fields.join(', ')} moved ` +
    `since the frozen baseline. If intended, delete ${config.baselinePath} or re-baseline once.`;
  if (config.strict) {
    // Throwing from async apply fails plugin activation — the --frozen posture.
    throw new Error(message);
  }
  console.warn(`[dsh-freeze] ${message}`);
}
