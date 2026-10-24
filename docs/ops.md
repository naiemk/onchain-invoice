# Ops / Docker

## Local smoke (before prod)

From this repo root:

```bash
npm run docker:test
```

Checks (in-network via compose exec): HTTPS health, HTTP→HTTPS redirect, HSTS headers, create rate limit (429).

Compose publishes host ports **18080/18443** (avoids clashing with a local API on 8080). Nested Docker environments may not reach published ports from the host; the smoke script uses container networking.

## Production

- Compose: nginx (TLS) + api (internal only) + **SQLite volume** (single API replica)
- Mount real certs at `deploy/certs/` (`fullchain.pem`, `privkey.pem`)
- Config examples: `commerce/config/*.example.yaml`
- Never bake private keys into images
- Backup DB volume regularly (`sqlite3 .backup` or volume snapshot)

### One-host install (configs + start scripts)

```bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-api.sh | bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-nodes.sh | bash
```

Creates `onchain-invoice-api.yaml` / `onchain-invoice-nodes.yaml` (if missing), bundler and wallet-activator (`wallet-deployer-evm`) YAMLs, and `./start-onchain-invoice-*.sh`. Nodes compose runs sweepers **plus** bundler + wallet activator from the **sweeper** image (command override). Details: [`deploy/install/README.md`](https://github.com/naiemk/onchain-invoice/blob/main/deploy/install/README.md).

## Host config records and rules

- **Secrets live only in each service's `.env` on the host (mode 600).** Never commit them, paste them into PRs, or put them in `config` YAML in the repo.
- **Record config before any change:** `~/services/tcmain/nodes/config-record.sh` (shipped in each `dist/`) copies every product's `.env`, YAML and compose files plus running image digests into `~/tc-config-records/<UTC timestamp>/` (700/600) and updates `~/tc-config-records/latest`. It prints file names and sha256 only, never values.
- **Never rename or move service files or folders to `*.bak`** (or `.old`). The installers and update agent do not do this; stray `.env.bak*` copies hold live secrets next to the working tree. Use `config-record.sh` instead.
- **One service user.** Install, cron and file ownership must be the same account. Container-written activity logs live in `nodes/logs/activity/` (uid 1000); `nodes/logs/` stays host-owned so `auto-update.log` is writable. `start-nodes.sh` fails early with the fix if `logs/` is not writable.
- **Adding an API setting?** `config.ts` env vars must be listed in `start-api.sh` (`add_env`) — `test/DeployEnvParity.ts` enforces this, so a variable can no longer be set on the host yet silently never reach the container.

## CI

`.github/workflows/docker.yml` builds and pushes API, sweeper, UI, and nginx images on every `main` commit. Bundler and wallet activator (`wallet-deployer-evm`) are **not** separate GHCR packages — they reuse the sweeper image.

## System tests (published images)

```bash
npm run system-test
```

Pulls `ghcr.io/naiemk/trustless-commerce-{api,sweeper,ui,nginx}` (tag via `IMAGE_TAG`, default `main`), mounts [`system-tests/configs/`](../system-tests/configs/), and asserts API + sweeper node + UI. See [`system-tests/README.md`](../system-tests/README.md).

Nightly / post-Docker workflow: `.github/workflows/system-tests.yml`.
