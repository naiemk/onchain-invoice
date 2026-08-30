# Deploy

## Local smoke (api + ui)

From repo root:

```bash
npm run docker:test
```

Builds and runs `docker-compose.yml` (api on **18080**, ui on **18081**). Smoke checks health/ready, UI root, and create rate limit. TLS/edge is not in this compose — use the host gateway from vibed-infra 0.8.

## Images (GHCR)

Built on every **pull request** and push to `main` by [`.github/workflows/docker.yml`](../.github/workflows/docker.yml). PRs publish `pr-<n>` tags; merges to `main` publish `:main`.

- `ghcr.io/naiemk/trustless-commerce-api`
- `ghcr.io/naiemk/trustless-commerce-sweeper`
- `ghcr.io/naiemk/trustless-commerce-ui`

## VPS install (vibed-infra 0.8 multi-tenant)

Two products share one host gateway under `~/services/`:

| Product | Role | Dist |
|---------|------|------|
| **tctest** | testnet | [`tctest/dist/`](tctest/dist/) |
| **tcmain** | mainnet | [`tcmain/dist/`](tcmain/dist/) |

Package (from repo root after `npm install`):

```bash
npm run deploy:package  # or bash deploy/package.sh
```

Install from a packaged dist (example for tctest):

```bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/tctest/dist/install-api.sh | bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/tctest/dist/install-ui.sh | bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/tctest/dist/install-nodes.sh | bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/tctest/dist/install-gateway.sh | bash
```

Gateway lives once at `~/services/gateway`; products drop site config under `apps/{product}/`. Overlays: [`overlays/`](overlays/). Operator console (CREATE2): [`operator/`](operator/).

## Checklist

1. Package both products (`deploy/package.sh`) and commit `tctest/dist` + `tcmain/dist` when shipping installers
2. Distinct `ADMIN_API_KEY` / `SWEEPER_API_KEY` per environment
3. Register sweeper wallets via `register-onchain-invoice-node.sh` in each product dist
4. Mainnet: set real `SWEEPER_ADDRESS` + `FORWARDER_IMPLEMENTATION` after contract deploy
