# System tests (published Docker images)

Pull GHCR images and verify API + sweeper node + UI through the edge gateway.

Operator one-liner install (configs + start scripts) lives in [`deploy/install/`](../deploy/install/).

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
| `docker-compose.yml` | Pull-only stack (api, ui, sweeper, nginx) |
| `configs/*.yaml` | Example API/sweeper YAML (operator shape; suite is env-driven) |
| `.env.example` | Keys + throwaway Hardhat #0 sweeper wallet |
| `tests/*.sh` | Assertions via `docker compose exec` |
| `scripts/run-install-e2e.sh` | wget\|bash installer path for API + sweeper |

Host ports: **18080** / **18443** (compose). Installer e2e publishes API on **8080**. Tests prefer in-container checks.

## Operator install (wget \| bash)

```bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-api.sh | bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-nodes.sh | bash
```

Creates YAML, start scripts, `.env` / `.env.example`, and (nodes) `register-onchain-invoice-node.sh`. See [`deploy/install/README.md`](../deploy/install/README.md). Covered by `npm run system-test:install`.