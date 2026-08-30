---
name: Configure DNS for tcmain
description: >-
  Paste this entire skill into an AU agent browser extension. Configure DNS A
  records for the domains below to point at the VPS IP listed in the table.
  Confirm IPv4 `57.131.150.182` with the operator before changing records — do not invent a different IP.
---

# DNS setup for tcmain

## Before you change anything

1. **Confirm the VPS public IPv4 is `57.131.150.182`** (from `gateway.publicIp` in product config). If the operator says the IP changed, use their new IP and ask them to update config / re-package.
2. Optionally ask for IPv6 if they want AAAA records.
3. Confirm which DNS provider UI they use (Cloudflare, registrar, Route53, etc.).
4. Ensure you are logged into that provider in the browser before editing records.

## Records to create or update

For each hostname, create an **A** record with the value in the table (TTL auto or 300).

| Hostname | Type | Value |
|----------|------|-------|
| `trustless-commerce.com` | A | `57.131.150.182` |
| `www.trustless-commerce.com` | A | `57.131.150.182` |

Do **not** create a CNAME for the apex unless the user explicitly asks. Prefer A records for all names listed.

If the user also provides an IPv6 address, add matching **AAAA** records for the same names.

## After saving DNS

1. Wait for propagation (often 1–5 minutes on Cloudflare; longer elsewhere).
2. Verify with dig/nslookup that each name resolves to the IPv4 in the table.
3. Tell the user to run on the VPS: `cd ~/services/gateway && ./setup-tls.sh` (or re-run `install-gateway.sh`), then `./start-gateway.sh` if the gateway is not up yet.

## Safety

- Never invent IPs, domains, or credentials.
- The packaged IP is `57.131.150.182`; only change it if the operator confirms a new address.
- Do not delete unrelated DNS records.
- If a record already exists with a different target, confirm with the user before overwriting.
