# Deploy

## Local test

From this repo root:

```bash
npm run docker:test
```

Checks HTTPS health, HTTP→HTTPS redirect, HSTS, and create rate limit (via compose networking). Host ports are **18080/18443**.

## Images (GHCR)

Built on every push to `main` by [`.github/workflows/docker.yml`](../.github/workflows/docker.yml). Reusable pattern: [`infra/github/workflows/docker-build-reusable.yml`](../infra/github/workflows/docker-build-reusable.yml).

- `ghcr.io/naiemk/trustless-commerce-api`
- `ghcr.io/naiemk/trustless-commerce-sweeper`
- `ghcr.io/naiemk/trustless-commerce-ui`
- `ghcr.io/naiemk/trustless-commerce-nginx`

## Domains (testnet + mainnet on one VPS)

Same-origin APIs:

| Host | Stack | Chain |
|------|--------|--------|
| `https://testnet.trustless-commerce.com` | testnet-api + testnet-ui | Sepolia |
| `https://trustless-commerce.com` (+ `www`) | mainnet-api + mainnet-ui | Mainnet |

Compose file: [`docker-compose.domains.yml`](docker-compose.domains.yml)  
Nginx routing: [`nginx/domains/domains.conf`](nginx/domains/domains.conf)

### Namecheap DNS → `206.189.49.251`

| Type | Host | Value |
|------|------|--------|
| A | `@` | `206.189.49.251` |
| A | `www` | `206.189.49.251` |
| A | `testnet` | `206.189.49.251` |

Wait until DNS resolves before requesting certificates.

### SSH runbook (VPS)

```bash
# 1) Prereqs
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 certbot
sudo systemctl enable --now docker
# free ports 80/443 from stock nginx if present:
sudo systemctl disable --now nginx || true

# 2) Data dirs (API image USER node = uid 1000)
sudo mkdir -p /var/lib/trustless-commerce/{testnet,mainnet}/api /var/www/certbot
sudo chown -R 1000:1000 /var/lib/trustless-commerce

# 3) Clone repo (or sync deploy/)
git clone https://github.com/naiemk/onchain-invoice.git
cd onchain-invoice

# 4) Env files
cp deploy/.env.domains.example deploy/.env.domains
cp deploy/.env.testnet.example deploy/.env.testnet
cp deploy/.env.mainnet.example deploy/.env.mainnet
# edit: strong ADMIN/SWEEPER keys; mainnet SWEEPER_ADDRESS + FORWARDER_IMPLEMENTATION when ready

# 5) TLS (one SAN cert) — nothing else on :80
sudo certbot certonly --standalone \
  -d trustless-commerce.com \
  -d www.trustless-commerce.com \
  -d testnet.trustless-commerce.com

# 6) Start
docker compose -f deploy/docker-compose.domains.yml --env-file deploy/.env.domains pull
docker compose -f deploy/docker-compose.domains.yml --env-file deploy/.env.domains up -d

# 7) Verify
curl -fsS https://testnet.trustless-commerce.com/api/health
curl -fsS https://trustless-commerce.com/api/health
```

Renewal (example): keep using certbot; after renew, `docker compose -f deploy/docker-compose.domains.yml --env-file deploy/.env.domains restart nginx`. HTTP serves `/.well-known/acme-challenge/` from `/var/www/certbot` for webroot renewals if you switch off standalone later.

### Sweeper nodes

Prefer the wget installers on worker hosts ([`install/README.md`](install/README.md)):

- Testnet node: `API_URL=https://testnet.trustless-commerce.com` then `./register-onchain-invoice-node.sh` + `./start-onchain-invoice-nodes.sh`
- Mainnet node: same with `https://trustless-commerce.com` and mainnet keys/addresses

## Operator install (wget | bash, includes HTTPS gateway)

Preferred path for a VPS: API(s) + **install-gateway** (nginx + UI + Let's Encrypt mounts) + sweeper nodes.

**Infra packager:** generic installer under [`infra/`](../infra/README.md). Product config: [`packageconfig.yaml`](packageconfig.yaml). Templates: [`templates/`](templates/).

See [`install/README.md`](install/README.md):

```bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-api.sh | bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-gateway.sh | bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-nodes.sh | bash
```

Or interactive (all components):

```bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install.sh | bash
```

`docker-compose.domains.yml` is an equivalent all-in-one compose alternative to the wget gateway.

## Checklist

1. DNS A records for `@`, `www`, `testnet`
2. Let’s Encrypt SAN cert mounted into nginx
3. Separate SQLite dirs per environment; single API replica each
4. Distinct `ADMIN_API_KEY` / `SWEEPER_API_KEY` per environment
5. Register sweeper wallets per environment via `register-onchain-invoice-node.sh`
6. Mainnet: set real `SWEEPER_ADDRESS` + `FORWARDER_IMPLEMENTATION` after contract deploy
