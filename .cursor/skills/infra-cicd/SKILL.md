---
name: infra-cicd
description: >-
  Set up GitHub Actions CI/CD for infra-packaged products: GHCR image build,
  compose smoke, and install e2e against published images. Use when adding deploy
  pipelines for Backend/UI/worker images.
---

# Infra packager CI/CD

## Image build (GHCR)

Use reusable workflow [`infra/github/workflows/docker-build-reusable.yml`](../../infra/github/workflows/docker-build-reusable.yml):

```yaml
jobs:
  images:
    uses: ./infra/github/workflows/docker-build-reusable.yml
    with:
      images: |
        api=deploy/Dockerfile.api=ghcr.io/${{ github.repository_owner }}/my-api
        ui=deploy/Dockerfile.ui=ghcr.io/${{ github.repository_owner }}/my-ui
        worker=deploy/Dockerfile.worker=ghcr.io/${{ github.repository_owner }}/my-worker
    secrets: inherit
```

Tags: `:main`, `main-<sha>`, semver on tag push.

## Install e2e (optional job)

1. Serve repo over HTTP (Python `http.server` at repo root or multi-path).
2. Set `PACKAGER_RAW=http://127.0.0.1:PORT/infra` and `PACKAGECONFIG_URL=.../deploy/packageconfig.yaml`.
3. Run `wget | bash deploy/install/install-api.sh` into temp dir.
4. Fill `.env` with test secrets; `./start-*.sh`; curl health.

See [`system-tests/scripts/run-install-e2e.sh`](../../system-tests/scripts/run-install-e2e.sh).

## packageconfig in CI

- `IMAGE_TAG=main` in system tests matches GHCR `:main` from default branch push.
- Keep `rawBase` pointing at `main` branch raw URLs for operator wget; dev branches use `ONCHAIN_INVOICE_REF=<branch>`.

## Checklist

- [ ] Dockerfiles under `deploy/`
- [ ] `deploy/packageconfig.yaml` images match GHCR names
- [ ] `npm run system-test:install` or workflow job passes
- [ ] Secrets not in templates — only `.env.example` placeholders
