---
name: infra-packager
description: >-
  Wire a new product to vibed-infra 0.8: four YAML templates, package.sh →
  committed dist/, multi-tenant apps under deploy/, GHCR OIDC pulls, and CI.
  Use when adding Backend/UI/worker deploy or migrating from ad-hoc install scripts.
---

# Infra packager — vibed-infra 0.8 multi-app

## When to use

- New product needs wget VPS install (api + ui + workers + shared host gateway)
- Multi-tenant products on one VPS (this repo: **tctest** + **tcmain**)

## Layout (Trustless Commerce)

| Path | Role |
|------|------|
| `deploy/tctest/templates/` | Four YAMLs: `vibed-infra-config.yml`, `api-config.yaml`, `ui-config.yaml`, `nodes-config.yaml` |
| `deploy/tcmain/templates/` | Same for mainnet |
| `deploy/package.sh` | Runs vibed `package.sh` → `deploy/{tctest,tcmain}/dist/` + TC overlays |
| `deploy/overlays/` | Product `start-*.sh` / compose / `.env.*.example` copied into dist |
| `~/services/` on VPS | Host gateway + update-agent (machine-wide) |

## Steps

1. **Depend on** `vibed-infra@0.8.x` (`npm i vibed-infra@0.8.0 --save-exact`).

2. **Templates** under `deploy/<product>/templates/` — set `gateway.publicIp`, `gateway.tlsEmail`, `gateway.sites[]` (backend/ui container names on `network.edge`).

3. **Package and commit dist:**

```bash
npm run deploy:package   # or bash deploy/package.sh
git add deploy/tctest/dist deploy/tcmain/dist && git commit
```

4. **VPS install** (per product dist):

```bash
wget -qO- .../deploy/tctest/dist/install-api.sh | bash
# edit .env → ./start-api.sh
wget -qO- .../deploy/tctest/dist/install-ui.sh | bash
wget -qO- .../deploy/tctest/dist/install-nodes.sh | bash
wget -qO- .../deploy/tctest/dist/install-gateway.sh | bash  # extends ~/services/gateway
```

5. **CI** — package drift check + GHCR build + OIDC notify (`id-token: write`). See infra-cicd.

## Rules

- Infra never parses opaque app config keys — only images, ports, volumes, site hostnames.
- Never overwrite existing `.env` on re-install.
- No product nginx image — TLS is the **host gateway** under `~/services/gateway`.
- Container names in `sites[]` must match running API/UI on `vps-edge`.
- Immediate pull after `:main` push requires CI `id-token: write` + `notify-vps-pull.py`.
