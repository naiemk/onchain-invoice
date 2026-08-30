# System tests (published Docker images)

Pull GHCR images and verify API + sweeper + UI (compose stack). TLS/edge is the VPS **host gateway** (vibed-infra 0.8), not a product nginx image.

**VPS / wget operator deployment:** see [`DEPLOYMENT.md`](DEPLOYMENT.md).  
Installers: [`deploy/tctest/dist/`](../deploy/tctest/dist/) (primary e2e) and [`deploy/tcmain/dist/`](../deploy/tcmain/dist/).

## Prerequisites

- Docker + Compose
- Ability to pull from `ghcr.io/naiemk/*` (or local tags with `PULL=0`)

## Run

```bash
# from repo root
cp system-tests/.env.example system-tests/.env   # first time
npm run system-test
```

`npm run system-test` runs the compose suite (API + sweeper + UI), tears it down, then the **wget installer e2e** (tctest `install-api` / `install-nodes` → `start-api.sh` / `start-nodes.sh` → health / invoice / sweeper auth).

Installer e2e only:

```bash
npm run system-test:install
```

**Infra packager e2e** (Hardhat fork + separate api/nodes dirs + local `:local` images; UI container on `vps-edge`, no product nginx):

```bash
npm run system-test:infra-deploy
BUILD_LOCAL=0 npm run system-test:infra-deploy
```

Override image tag: `IMAGE_TAG=main npm run system-test`. Local tags: `PULL=0 IMAGE_TAG=system-test-local npm run system-test`.

## Layout

| Path | Role |
|------|------|
| `DEPLOYMENT.md` | VPS wget deploy (tctest/tcmain dist + host gateway) |
| `docker-compose.yml` | Pull-only stack (api, ui, sweeper) |
| `scripts/packager-http.sh` | Serves vibed-infra + `deploy/tctest/dist` |
| `scripts/run-install-e2e.sh` | wget install path for tctest API + workers |
| `scripts/run-infra-deploy-e2e.sh` | Hardhat + packager api/nodes + UI container |

Host ports: **18080** (api) / **18081** (ui). Installer e2e publishes API on **8080**.
