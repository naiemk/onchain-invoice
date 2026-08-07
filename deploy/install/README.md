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

### 4) Sweeper nodes (testnet — Sepolia + Nile + Solana Devnet)

```bash
# Replace any old single/dual sweeper layout first:
docker rm -f onchain-invoice-node \
  onchain-invoice-sweeper-evm onchain-invoice-sweeper-tron onchain-invoice-sweeper-solana 2>/dev/null || true

mkdir -p ~/tc/sweeper && cd ~/tc/sweeper
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-nodes.sh | bash
# .env: API_URL=https://testnet.trustless-commerce.com
#       SWEEPER_CHAINS=11155111,nile,devnet
#       TRON_* + SOLANA_PROGRAM_ID / SOLANA_SWEEPER_KEY / SOLANA_FEE_RECIPIENT
./register-onchain-invoice-node.sh
./start-onchain-invoice-nodes.sh
# → onchain-invoice-sweeper-evm + -tron + -solana
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
# edit .env: TRON_* + SOLANA_* + SWEEPER_CHAINS=11155111,nile,devnet
./register-onchain-invoice-node.sh
./start-onchain-invoice-nodes.sh   # triple compose: sweeper-evm + sweeper-tron + sweeper-solana
```

Optional: `./register-onchain-invoice-node.sh --address 0x… --label dtn-node --chains 11155111,nile,devnet`

Activity logs: `./logs/activity-evm.jsonl`, `activity-tron.jsonl`, `activity-solana.jsonl`.

## Gateway only

```bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-gateway.sh | bash
./start-onchain-invoice-gateway.sh
```

## Auto-update (optional per role)

Host cron pulls GHCR images and recreates containers only when the image digest changed. Sweeper updates use `docker stop -t` so an in-flight sweep can finish before recreate.

| Flag | Container | Default | Interval env |
|------|-----------|---------|--------------|
| `UI_TESTNET_AUTO_UPDATE` | `testnet-ui` | on | `GATEWAY_AUTO_UPDATE_INTERVAL_MIN` (5m) |
| `UI_MAINNET_AUTO_UPDATE` | `mainnet-ui` | on | same cron |
| `GATEWAY_AUTO_UPDATE` | nginx gateway | on | same cron |
| `NODES_AUTO_UPDATE` | sweeper node | on (testnet example) | `NODES_AUTO_UPDATE_INTERVAL_MIN` (15m) |
| `API_AUTO_UPDATE` | API | **off** | `API_AUTO_UPDATE_INTERVAL_MIN` (15m) |

```bash
# After editing flags in .env:
cd ~/tc/gateway && ./install-auto-update.sh
cd ~/tc/sweeper && ./install-auto-update.sh
cd ~/tc/api-testnet && ./install-auto-update.sh   # only schedules if API_AUTO_UPDATE=1

# Host log:
tail -f ~/tc/gateway/logs/auto-update.log
```

Installers refresh cron from these flags (no `ROLE=` required). Legacy `AUTO_UPDATE` is still accepted if the role flag is unset.

## Sweeper activity log

Paid invoices, sweep txs, and failures are appended as JSONL on the host:

```bash
tail -f ~/tc/sweeper/logs/activity-evm.jsonl ~/tc/sweeper/logs/activity-tron.jsonl
```

Stages: `invoice-paid`, `sweep-submitted`, `sweep-confirmed`, `sweep-failed`, `tick-failed`.

## Notes

- Existing config/start/`.env` files are **not** overwritten (secrets stay).
- Prefer editing **`.env`**. Start scripts load `.env` when variables are unset **or empty** (non-empty shell exports win).
- Installers **refresh** `.env.*.example` / `.env.example` on every run and **append** missing auto-update keys into an existing `.env`.
- Empty env vars are **not** passed as `docker -e KEY=` (so they cannot wipe config).
- Quote `0x…` values in YAML (installer templates already do) — unquoted YAML 1.1 corrupts private keys.
- For HTTPS, API containers must be named `testnet-api` / `mainnet-api` on `DOCKER_NETWORK=trustless-commerce-edge` (set via `.env`).
- Certs live on the host under `/etc/letsencrypt` (never committed). Gateway mounts them read-only.
- Linux: start-nodes adds `host.docker.internal`. Prefer `SERVER_URL=https://testnet.trustless-commerce.com` once the gateway is up.
- `INSTALL_DIR=/opt/tc bash install-api.sh` installs into another directory.
- Branch/dev: `ONCHAIN_INVOICE_RAW=https://raw.githubusercontent.com/naiemk/onchain-invoice/<ref>/deploy/install`
- Skip pull: `ONCHAIN_INVOICE_SKIP_PULL=1` or `PULL=0`
- API data dir and sweeper `./logs` are chown'd to uid `1000` (`node` in the image).
- Alternative all-in-one compose (no wget): [`../docker-compose.domains.yml`](../docker-compose.domains.yml).
