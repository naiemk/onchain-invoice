# System tests (published Docker images)

Pull GHCR images and verify API + sweeper node + UI through the edge gateway.

**VPS / wget operator deployment:** see [`DEPLOYMENT.md`](DEPLOYMENT.md).  
Installer sources: [`deploy/install/`](../deploy/install/).

## Prerequisites

- Docker + Compose
- Ability to pull from `ghcr.io/naiemk/*` (or local tags with `PULL=0`)

## Run

```bash
# from repo root
cp system-tests/.env.example system-tests/.env   # first time
npm run system-test
```

`npm run system-test` runs the compose suite (API + sweeper + UI), tears it down, then the **wget installer e2e** (install-api / install-nodes → start scripts → health / invoice / sweeper auth).

Installer e2e only:

```bash
npm run system-test:install
```

**Infra packager full-stack e2e** (Hardhat Sepolia fork + separate api/nodes/gateway install dirs + local `:local` images):

```bash
npm run system-test:infra-deploy
# skip image rebuild when :local tags already exist:
BUILD_LOCAL=0 npm run system-test:infra-deploy
```

Deploys `CommerceInvoiceSweeper` to a forked Hardhat RPC, wget-installs all three infra profiles into temp dirs, starts API → sweepers → gateway (UI smoke + `/api/health` via nginx).

Override image tag:

```bash
IMAGE_TAG=main npm run system-test
```

Use locally built images (skip GHCR pull):

```bash
# build tags first, then:
PULL=0 IMAGE_TAG=system-test-local npm run system-test
```

## Layout

| Path | Role |
|------|------|
| `DEPLOYMENT.md` | Full VPS wget deploy runbook (API, gateway, sweeper, auto-update) |
| `docker-compose.yml` | Pull-only stack (api, ui, sweeper, nginx) |
| `configs/*.yaml` | Example API/sweeper YAML (operator shape; suite is env-driven) |
| `.env.example` | Keys + throwaway Hardhat #0 sweeper wallet |
| `tests/*.sh` | Assertions via `docker compose exec` |
| `scripts/run-install-e2e.sh` | wget\|bash installer path for API + sweeper |
| `scripts/run-infra-deploy-e2e.sh` | Hardhat fork + infra packager api/nodes/gateway dirs |

Host ports: **18080** / **18443** (compose). Installer e2e publishes API on **8080**. Tests prefer in-container checks.

## Operator install (wget \| bash)

Quick one-liners (full runbook in [`DEPLOYMENT.md`](DEPLOYMENT.md)):

```bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-api.sh | bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-nodes.sh | bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-gateway.sh | bash
```

Creates YAML, start scripts, `.env` / `.env.example`, and (nodes) `register-onchain-invoice-node.sh`. Covered by `npm run system-test:install`.
