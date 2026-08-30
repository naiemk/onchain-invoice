---
name: infra-cicd
description: >-
  GitHub Actions for vibed-infra 0.8 products: package drift, GHCR build,
  OIDC instant VPS pull, compose smoke, and install e2e against published images.
---

# Infra packager CI/CD (vibed-infra 0.8)

## Product workflow (this repo)

[`.github/workflows/docker.yml`](../../.github/workflows/docker.yml):

1. **checkout → setup-node → npm ci**
2. **Package drift** — `bash deploy/package.sh` then `git diff --exit-code -- deploy/tctest/dist deploy/tcmain/dist`
3. **Buildx + GHCR login** — push api / sweeper / ui (no nginx image)
4. **Notify VPS** (default branch) — `notify-vps-pull.py` from each dist with OIDC (`permissions.id-token: write`)
5. **Local compose smoke** — `deploy/docker-compose.yml` (api + ui only)
6. **System tests** on `main` — published `:main` tags + wget install e2e

## Permissions

```yaml
permissions:
  contents: read
  packages: write
  id-token: write   # required for OIDC instant pull
```

## Install e2e

1. Serve vibed-infra + repo over HTTP (`system-tests/scripts/packager-http.sh`).
2. Point at **tctest dist**: `PACKAGECONFIG_URL=.../deploy/tctest/dist/packageconfig.yaml`, `RAW_BASE=.../deploy/tctest/dist`.
3. `wget | bash install-api.sh` / `install-nodes.sh` → `./start-api.sh` / `./start-nodes.sh`.
4. Assert health, create invoice, sweeper register (`npm run system-test:install`).

## Checklist

- [ ] Four YAML templates per product under `deploy/{tctest,tcmain}/templates/`
- [ ] Committed `dist/` matches `npm run deploy:package`
- [ ] GHCR names match packageconfig `images.*`
- [ ] Workflow has `id-token: write`; no product nginx image
- [ ] Secrets only in `.env.*.example` placeholders
