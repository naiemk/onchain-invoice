---
name: system-gateway
description: >-
  Configure a system-wide HTTPS gateway on one VPS for multiple products/domains.
  Use when several infra-packaged projects share one host, edge network, and Let's Encrypt.
---

# System-wide gateway (multi-project)

## Model

- One **gateway** install dir per host (or per edge): nginx on ports 80/443.
- Each product **backend** + **UI** containers join the same Docker network (`network.edge` from each product's packageconfig — use one shared name, e.g. `vps-edge`).
- Gateway `sites[]` in one product's packageconfig **or** a dedicated `gateway-only` packageconfig lists all vhosts.

## Steps

1. Pick shared network: `DOCKER_NETWORK=vps-edge` in every product `.env`.

2. Install APIs/UIs with distinct container names:
   - `product-a-api`, `product-a-ui`
   - `product-b-api`, `product-b-ui`

3. Install gateway once:

```bash
mkdir -p ~/vps/gateway && cd ~/vps/gateway
wget -qO- .../install-gateway.sh | bash
```

4. Edit gateway `packageconfig` `sites[]` (or merge generated `gateway/conf.d/domains.conf`) so each `host` maps to the correct `backend` + `ui` container names.

5. **TLS** — single SAN cert or per-host certs:

```bash
sudo certbot certonly --standalone \
  -d app-a.example.com -d app-b.example.com -d www.app-b.example.com
```

Set `TLS_FULLCHAIN` / `TLS_PRIVKEY` in gateway `.env`.

6. **Auto-update** — stagger cron: APIs :00, workers :10, gateway :20 (infra default).

## Trustless Commerce dual-domain

- `testnet-api` + `testnet-ui` + `mainnet-api` + `mainnet-ui` on `trustless-commerce-edge`.
- Gateway profile in [`deploy/packageconfig.yaml`](../../deploy/packageconfig.yaml) `sites[]`.

## Pitfalls

- API must listen on container name resolvable by nginx (`testnet-api:8080`, not `localhost`).
- Do not bind host port 443 twice — only gateway publishes 443.
- Pull UI/nginx **before** stop on gateway update (infra update scripts do this).
