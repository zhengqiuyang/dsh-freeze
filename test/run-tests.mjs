/**
 * Unit tests for the pure fingerprint/diff logic over temp profile dirs.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffFingerprints, fingerprintProfile } from '../lib/fingerprint.js';
import { detectProfileName } from '../lib/index.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}`);
    console.error(err.message);
  }
}

function profile(overrides = {}) {
  return {
    'package.json': JSON.stringify(
      {
        name: 'dsh-profile-x',
        private: true,
        dependencies: overrides.deps ?? {
          'dsh-read-guard': 'github:zhengqiuyang/dsh-read-guard',
          'dsh-attest': 'github:zhengqiuyang/dsh-attest',
        },
        dsh: { profile: { bundles: overrides.bundles ?? ['@deepseek-ai/dsh-base', 'dsh-read-guard', 'dsh-attest'] } },
      },
      null,
      2,
    ),
    'pnpm-lock.yaml': overrides.lock ?? 'lock:\n  dsh-read-guard: abc123\n  dsh-attest: def456\n',
    ...(overrides.patch === null ? {} : { 'cordis.patch.yml': overrides.patch ?? '- insert: []\n' }),
  };
}

function makeDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-freeze-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

console.log('fingerprint');

await test('same files -> same fingerprint; key order in package.json does not matter', async () => {
  const a = makeDir(profile());
  const reordered = JSON.parse(JSON.stringify(profile()));
  const deps = reordered['package.json'];
  // Reorder dependencies keys in the JSON text.
  const parsed = JSON.parse(deps);
  parsed.dependencies = Object.fromEntries(Object.entries(parsed.dependencies).reverse());
  reordered['package.json'] = JSON.stringify(parsed, null, 2);
  const b = makeDir(reordered);
  try {
    const fa = await fingerprintProfile(a);
    const fb = await fingerprintProfile(b);
    assert.equal(fa.fingerprint, fb.fingerprint);
    assert.equal(fa.dependencies['dsh-attest'], 'github:zhengqiuyang/dsh-attest');
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

await test('missing package.json throws loudly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-freeze-'));
  try {
    await assert.rejects(() => fingerprintProfile(dir), /no package\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

console.log('diff');

await test('lockfile change is detected as pnpm-lock', async () => {
  const a = makeDir(profile());
  const b = makeDir(profile({ lock: 'lock:\n  dsh-read-guard: CHANGED\n  dsh-attest: def456\n' }));
  try {
    const d = diffFingerprints(await fingerprintProfile(a), await fingerprintProfile(b));
    assert.equal(d.ok, false);
    assert.deepEqual(d.fields, ['pnpm-lock']);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

await test('added dependency + bundle both reported', async () => {
  const a = makeDir(profile());
  const b = makeDir(
    profile({
      deps: {
        'dsh-read-guard': 'github:zhengqiuyang/dsh-read-guard',
        'dsh-attest': 'github:zhengqiuyang/dsh-attest',
        'dsh-janitor': 'github:zhengqiuyang/dsh-janitor',
      },
      bundles: ['@deepseek-ai/dsh-base', 'dsh-read-guard', 'dsh-attest', 'dsh-janitor'],
    }),
  );
  try {
    const d = diffFingerprints(await fingerprintProfile(a), await fingerprintProfile(b));
    assert.equal(d.ok, false);
    assert.ok(d.fields.includes('dependencies'));
    assert.ok(d.fields.includes('bundles'));
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

await test('patch layer change detected; absent vs present detected', async () => {
  const a = makeDir(profile());
  const b = makeDir(profile({ patch: '- insert:\n  - id: x\n    name: y\n' }));
  const c = makeDir(profile({ patch: null }));
  try {
    const fa = await fingerprintProfile(a);
    const fb = await fingerprintProfile(b);
    const fc = await fingerprintProfile(c);
    assert.equal(diffFingerprints(fa, fb).fields.includes('cordis.patch.yml'), true);
    assert.equal(diffFingerprints(fa, fc).fields.includes('cordis.patch.yml'), true);
  } finally {
    for (const d of [a, b, c]) rmSync(d, { recursive: true, force: true });
  }
});

await test('identical profiles are ok', async () => {
  const a = makeDir(profile());
  const b = makeDir(profile());
  try {
    assert.equal(diffFingerprints(await fingerprintProfile(a), await fingerprintProfile(b)).ok, true);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

console.log('profile detection');

await test('--profile from argv in both forms, default web', () => {
  assert.equal(detectProfileName(['node', 'dsh', '--profile', 'work', 'web']), 'work');
  assert.equal(detectProfileName(['node', 'dsh', '--profile=ci', 'web']), 'ci');
  assert.equal(detectProfileName(['node', 'dsh', 'web']), 'web');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
