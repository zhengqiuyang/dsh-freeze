# dsh-freeze

Hermetic composition lock for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).

**"Today's agent composition is byte-identical to the one you reviewed."**
Fingerprints the booted profile — installed dependencies (name-sorted), the
ordered bundle composition, the pnpm lockfile hash, the user patch layer —
baselines it, and compares on every boot. A session running on a drifted
composition says so loudly; `strict: true` fails the boot entirely (the
`--frozen` posture for CI). Zero LLM calls in the trust path.

Family: ... mcp-test (what agents can call) · prompt-drift (what they are
told) · **freeze (what exactly they are running)**.

## Why now (checked 2026-10-12)

The supply-chain lane has seven install-time scanners and one read-only
plugin ledger (`dsh-harbor`) — all answer "is this package ok to install?"
Nobody answers **"is the composition I'm running today the one that was
audited?"** Spike-verified: `dsh --dump-config` is byte-stable across runs,
and profile files (package.json / pnpm-lock.yaml / cordis.patch.yml) are the
complete composition truth — a deterministic fingerprint is sound.

## What moves the alarm

| field | meaning |
|---|---|
| `dependencies` | a package was added/removed/retargeted |
| `bundles` | the ordered composition changed |
| `pnpm-lock` | resolved versions moved (upgrade!) |
| `cordis.patch.yml` | the user layer changed |

## Install

```sh
dsh plugin --profile default add github:zhengqiuyang/dsh-freeze
```

Prebuilt `lib/` ships in the repo — git installs need no build step and no
`allowBuilds` authorization.

## Configure

```yaml
- id: dsh-freeze
  name: dsh-freeze
  config:
    baselinePath: .dsh-freeze/baseline.json
    strict: false          # true: drift fails the boot (CI posture)
    profile: ""            # '' auto-detects from argv (--profile, else 'web')
```

Note: the baseline is written into the *working directory* of the session by
default; for CI, point it somewhere durable and commit it.

## Develop

```sh
npm install && npm test
```

## Kill criteria

If dsh ships first-party profile pinning (`--frozen` boot flag or
equivalent), this freezes at its last working version with a postmortem
here.
