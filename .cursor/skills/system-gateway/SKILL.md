---
name: system-gateway
description: >-
  Configure vibed-infra 0.8 shared host HTTPS gateway so multiple products
  (tctest + tcmain) share one VPS (ports 80/443) without a product nginx image.
---

# System-wide host gateway (multi-app)

## Model

```
~/services/gateway/          # GATEWAY_HOME — once per machine
  setup-tls.sh               # LE or TLS_MODE=lab
  gateway/nginx.conf         # includes apps/*/sites.conf
  apps/
    tctest/sites.conf
    tcmain/sites.conf

~/services/vibed-infra/
  update-agent/              # serial GHCR pull queue (OIDC webhook)
```

- Shared Docker network: **`vps-edge`**.
- Only the **host** binds 80/443. Product `install-gateway.sh` bootstraps host if missing, writes `apps/{name}/sites.conf`, runs `setup-tls.sh`.
- API/UI join `DOCKER_NETWORK=vps-edge` with names like `tctest-api` / `tctest-ui`.

## Trustless Commerce

| Product | Dist | Example hosts |
|---------|------|----------------|
| tctest | `deploy/tctest/dist/` | `testnet.trustless-commerce.com` → `tctest-api` + `tctest-ui` |
| tcmain | `deploy/tcmain/dist/` | `trustless-commerce.com` → `tcmain-api` + `tcmain-ui` |

```bash
# DNS first — paste dist/DNS-SKILL.md into AU agent
wget -qO- .../deploy/tctest/dist/install-gateway.sh | bash
wget -qO- .../deploy/tcmain/dist/install-gateway.sh | bash  # adds sites + SANs only
```

## TLS / webhook

- Production: `gateway.tlsEmail` → certbot via `setup-tls.sh`.
- Lab/CI: `TLS_MODE=lab`.
- `/_vibed/hooks/ghcr` → update-agent (CI OIDC JWT). Do not expose update-agent port publicly.

## Pitfalls

- Do not run a second nginx on 80/443; do not ship a product `trustless-commerce-nginx` image.
- Site `backend` / `ui` names must match live containers on `vps-edge`.
- After host/IP change: `cd ~/services/gateway && ./setup-tls.sh --force`.
