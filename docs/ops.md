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

Creates `onchain-invoice-api.yaml` / `onchain-invoice-nodes.yaml` (if missing) and `./start-onchain-invoice-*.sh`. Details: [`deploy/install/README.md`](https://github.com/naiemk/onchain-invoice/blob/main/deploy/install/README.md).

## CI

`.github/workflows/docker.yml` builds and pushes API, sweeper, UI, and nginx images on every `main` commit.

## System tests (published images)

```bash
npm run system-test
```

Pulls `ghcr.io/naiemk/trustless-commerce-{api,sweeper,ui,nginx}` (tag via `IMAGE_TAG`, default `main`), mounts [`system-tests/configs/`](../system-tests/configs/), and asserts API + sweeper node + UI. See [`system-tests/README.md`](../system-tests/README.md).

Nightly / post-Docker workflow: `.github/workflows/system-tests.yml`.
