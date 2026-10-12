import Schema from '@deepseek-ai/schemastery';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { diffFingerprints, fingerprintProfile } from './fingerprint.js';
export const name = 'dsh-freeze';
export const Config = Schema.object({
    baselinePath: Schema.string().default('.dsh-freeze/baseline.json').description('baseline file with the frozen fingerprint'),
    strict: Schema.boolean().default(false).description('fail the boot on drift instead of warning (CI posture)'),
    profile: Schema.string().default('').description("profile name; empty auto-detects from argv (--profile, else 'web')"),
});
/** Extracted for tests: how the plugin decides which profile it runs in. */
export function detectProfileName(argv) {
    for (let i = 0; i < argv.length - 1; i++) {
        if (argv[i] === '--profile')
            return argv[i + 1] ?? '';
        const m = /^--profile=(.+)$/.exec(argv[i] ?? '');
        if (m)
            return m[1];
    }
    return 'web';
}
export function profileDirFor(profile, envHome, home) {
    const root = envHome && envHome.length > 0 ? envHome : join(home, '.dsh');
    return join(root, 'profiles', profile);
}
async function loadBaseline(path) {
    try {
        return JSON.parse(await readFile(path, 'utf8'));
    }
    catch {
        return null;
    }
}
export async function apply(ctx, config) {
    const profile = config.profile !== '' ? config.profile : detectProfileName(process.argv);
    const dir = profileDirFor(profile, process.env.DSH_HOME, homedir());
    if (!existsSync(join(dir, 'package.json'))) {
        console.warn(`[dsh-freeze] no profile dir at ${dir} — freeze gate idle`);
        return;
    }
    const current = await fingerprintProfile(dir);
    const baseline = await loadBaseline(config.baselinePath);
    if (baseline === null) {
        await mkdir(join(config.baselinePath, '..'), { recursive: true }).catch(() => { });
        await writeFile(config.baselinePath, JSON.stringify({ profile, ...current }, null, 2) + '\n', 'utf8');
        console.log(`[dsh-freeze] baseline frozen: profile '${profile}', ${Object.keys(current.dependencies).length} package(s), ` +
            `bundles=${current.bundles.length} -> ${config.baselinePath}`);
        return;
    }
    const diff = diffFingerprints(baseline, current);
    if (diff.ok) {
        console.log(`[dsh-freeze] composition matches baseline (${current.fingerprint.slice(0, 16)}…)`);
        return;
    }
    const message = `[dsh-freeze] COMPOSITION DRIFT in profile '${profile}': ${diff.fields.join(', ')} moved ` +
        `since the frozen baseline. If intended, delete ${config.baselinePath} or re-baseline once.`;
    if (config.strict) {
        // Throwing from async apply fails plugin activation — the --frozen posture.
        throw new Error(message);
    }
    console.warn(`[dsh-freeze] ${message}`);
}
