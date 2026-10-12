/**
 * Pure composition fingerprint over a profile directory: what is installed
 * (dependencies, sorted), what is composed (bundle list), and what the exact
 * versions and user layer are (lockfile + patch hashes). Stable by
 * construction — same files, same fingerprint, on any machine.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
function sha256Text(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}
async function readOptional(path) {
    try {
        return await readFile(path, 'utf8');
    }
    catch {
        return null;
    }
}
export async function fingerprintProfile(profileDir) {
    const pkgText = await readOptional(join(profileDir, 'package.json'));
    if (pkgText === null) {
        throw new Error(`dsh-freeze: no package.json in profile dir '${profileDir}'`);
    }
    const pkg = JSON.parse(pkgText);
    const dependencies = {};
    for (const name of Object.keys(pkg.dependencies ?? {}).sort()) {
        dependencies[name] = pkg.dependencies?.[name] ?? '';
    }
    const lockText = await readOptional(join(profileDir, 'pnpm-lock.yaml'));
    const patchText = await readOptional(join(profileDir, 'cordis.patch.yml'));
    const core = {
        dependencies,
        bundles: pkg.dsh?.profile?.bundles ?? [],
        lockSha256: lockText === null ? '(absent)' : sha256Text(lockText),
        ...(patchText === null ? {} : { patchSha256: sha256Text(patchText) }),
    };
    const fingerprint = sha256Text(JSON.stringify(core));
    return { ...core, fingerprint };
}
/** Which parts of the composition moved since the baseline. */
export function diffFingerprints(baseline, current) {
    const fields = [];
    if (JSON.stringify(baseline.dependencies) !== JSON.stringify(current.dependencies)) {
        fields.push('dependencies');
    }
    if (JSON.stringify(baseline.bundles) !== JSON.stringify(current.bundles)) {
        fields.push('bundles');
    }
    if (baseline.lockSha256 !== current.lockSha256)
        fields.push('pnpm-lock');
    if ((baseline.patchSha256 ?? '(absent)') !== (current.patchSha256 ?? '(absent)')) {
        fields.push('cordis.patch.yml');
    }
    return { ok: fields.length === 0, fields };
}
