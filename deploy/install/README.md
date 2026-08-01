# Operator install (wget | bash)

Bootstrap API, HTTPS gateway (nginx + UI), and sweeper nodes on any host with Docker.

## HTTPS domains (recommended)

Same-origin APIs:

| Host | API container | UI container |
|------|---------------|--------------|
| `https://testnet.trustless-commerce.com` | `testnet-api` | `testnet-ui` |
| `https://trustless-commerce.com` (+ `www`) | `mainnet-api` | `mainnet-ui` |

### 0) DNS + TLS (once)

Namecheap A records `@`, `www`, `testnet` → this host’s IP.

```bash
# port 80 must be free
sudo certbot certonly --standalone \
  -d trustless-commerce.com \
  -d www.trustless-commerce.com \
  -d testnet.trustless-commerce.com
```

### 1) Testnet API

```bash
mkdir -p ~/tc/api-testnet && cd ~/tc/api-testnet
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-api.sh | bash
# .env already has DOCKER_NAME=testnet-api and DOCKER_NETWORK=trustless-commerce-edge
# edit ADMIN_API_KEY / SWEEPER_API_KEY / Sepolia addresses
./start-onchain-invoice-api.sh
```

### 2) Mainnet API (optional until contracts are live)

```bash
mkdir -p ~/tc/api-mainnet && cd ~/tc/api-mainnet
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-api.sh | bash
# in .env:
#   BASE_URL=https://trustless-commerce.com
#   DOCKER_NAME=mainnet-api
#   DOCKER_NETWORK=trustless-commerce-edge
#   different ADMIN/SWEEPER keys; set mainnet SWEEPER_ADDRESS later
# use a free host port if testnet already took 8080, e.g. in onchain-invoice-api.yaml:
#   docker.port: 8081
./start-onchain-invoice-api.sh
```

### 3) HTTPS gateway (nginx + UI)

```bash
mkdir -p ~/tc/gateway && cd ~/tc/gateway
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-gateway.sh | bash
# confirm TLS_* paths in .env match certbot output
./start-onchain-invoice-gateway.sh

curl -fsS https://testnet.trustless-commerce.com/api/health
curl -fsS https://trustless-commerce.com/api/health
```

### 4) Sweeper node (testnet example)

```bash
mkdir -p ~/tc/sweeper && cd ~/tc/sweeper
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-nodes.sh | bash
# .env: API_URL=https://testnet.trustless-commerce.com  (same ADMIN_API_KEY as testnet API)
./register-onchain-invoice-node.sh
./start-onchain-invoice-nodes.sh
```

## API only (no gateway)

```bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-api.sh | bash
# edit .env, then:
./start-onchain-invoice-api.sh
```

Creates (if missing): `onchain-invoice-api.yaml`, `start-onchain-invoice-api.sh`, `.env` / `.env.example`.

## Sweeper nodes only

```bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-nodes.sh | bash
./register-onchain-invoice-node.sh
./start-onchain-invoice-nodes.sh
```

Optional: `./register-onchain-invoice-node.sh --address 0x… --label dtn-node --chains 11155111`

## Gateway only

```bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-gateway.sh | bash
./start-onchain-invoice-gateway.sh
```

## Notes

- Existing config/start/`.env` files are **not** overwritten.
- Prefer editing **`.env`**. Start scripts load `.env` for unset variables only (shell exports win).
- Empty env vars are **not** passed as `docker -e KEY=` (so they cannot wipe config).
- For HTTPS, API containers must be named `testnet-api` / `mainnet-api` on `DOCKER_NETWORK=trustless-commerce-edge` (set via `.env`).
- Certs live on the host under `/etc/letsencrypt` (never committed). Gateway mounts them read-only.
- Linux: start-nodes adds `host.docker.internal`. Prefer `SERVER_URL=https://testnet.trustless-commerce.com` once the gateway is up.
- `INSTALL_DIR=/opt/tc bash install-api.sh` installs into another directory.
- Branch/dev: `ONCHAIN_INVOICE_RAW=https://raw.githubusercontent.com/naiemk/onchain-invoice/<ref>/deploy/install`
- Skip pull: `ONCHAIN_INVOICE_SKIP_PULL=1` or `PULL=0`
- API data dir is chown'd to uid `1000` (`node` in the image).
- Alternative all-in-one compose (no wget): [`../docker-compose.domains.yml`](../docker-compose.domains.yml).
