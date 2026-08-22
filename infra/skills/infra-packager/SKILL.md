---
name: infra-packager
description: >-
  Wire a new product to the infra VPS packager: packageconfig.yaml, Docker images,
  deploy/templates, thin install wrappers, and CI. Use when adding Backend/UI/worker
  deploy to a repo or migrating from ad-hoc deploy/install scripts.
---

# Infra packager — onboard a product

## When to use

- New repo needs wget VPS install (backend + UI + workers + HTTPS gateway)
- Splitting deploy scripts into reusable infra + product templates

## Steps

1. **Copy or submodule** [`infra/`](../../infra/) (later: separate `infra-packager` repo; set `packagerRaw` in packageconfig).

2. **Create** `deploy/packageconfig.yaml` — see [`infra/schema/packageconfig.md`](../../infra/schema/packageconfig.md) and Trustless Commerce example [`deploy/packageconfig.yaml`](../../deploy/packageconfig.yaml).

3. **Add templates** under `deploy/templates/`:
   - `.env.*.example` (secrets — opaque to infra)
   - App config YAML (opaque)
   - `start-*.sh` / `update-*.sh` (or use generic `infra/start.sh`)
   - Worker `docker-compose.*.yml` if multi-runner

4. **Thin wrappers** (3 lines each):

```bash
# deploy/install/install-api.sh
export INFRA_PROFILE=api
export PACKAGECONFIG_URL=https://raw.githubusercontent.com/ORG/REPO/main/deploy/packageconfig.yaml
wget -qO- https://raw.githubusercontent.com/ORG/REPO/main/infra/install.sh | bash
```

5. **Build images** — Dockerfiles in `deploy/`; push to GHCR; reference in `packageconfig.images`.

6. **CI** — use [`infra/github/workflows/docker-build-reusable.yml`](../../infra/github/workflows/docker-build-reusable.yml); add install e2e serving `infra/` + `deploy/templates/` over HTTP.

7. **VPS** — per component directory:

```bash
mkdir -p ~/app/api && cd ~/app/api
wget -qO- .../deploy/install/install-api.sh | bash
# edit .env, then ./start-onchain-invoice-api.sh (or ./start.sh)
```

## Rules

- Infra never parses app config keys — only image names, ports, volume paths, site hostnames.
- Never overwrite existing `.env` on re-install.
- Gateway container names must match `sites[].backend` / `sites[].ui` on shared `network.edge`.
