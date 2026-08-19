# Operator install (wget | bash)

Bootstrap API, HTTPS gateway (nginx + UI), and sweeper nodes on any host with Docker.

Uses the **[infra packager](../../infra/README.md)** (`infra/install.sh`) with Trustless Commerce [`packageconfig.yaml`](../packageconfig.yaml) and [`templates/`](../templates/).

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
#   different ADMIN/SWEEPER keys; set EVM_8453_* / EVM_56_* sweeper+forwarder after CREATE2
#   TRON_FULL_HOST=https://api.trongrid.io  TRON_USDT_ADDRESS=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
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

### 4) Sweeper nodes (testnet — Sepolia + Nile; Solana optional)

```bash
# Replace any old single/dual sweeper layout first:
docker rm -f onchain-invoice-node \
  onchain-invoice-sweeper-evm onchain-invoice-sweeper-tron onchain-invoice-sweeper-solana 2>/dev/null || true

mkdir -p ~/tc/sweeper && cd ~/tc/sweeper
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-nodes.sh | bash
# .env: API_URL=https://testnet.trustless-commerce.com
#       SWEEPER_CHAINS=11155111,nile
#       TRON_* keys
# Solana (optional): SWEEPER_SOLANA_ENABLED=1, SWEEPER_CHAINS=…,devnet,
#       SOLANA_PROGRAM_ID / SOLANA_SWEEPER_KEY — also set program id on the API .env
./register-onchain-invoice-node.sh
./start-onchain-invoice-nodes.sh
# → onchain-invoice-sweeper-evm + -tron (+ -solana only if SWEEPER_SOLANA_ENABLED=1)
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
./start-onchain-invoice-nodes.sh   # compose: sweeper-evm + sweeper-tron (+ solana if SWEEPER_SOLANA_ENABLED=1)
```

Optional: `./register-onchain-invoice-node.sh --address 0x… --label dtn-node --chains 11155111,nile,devnet`

Activity logs: `./logs/activity-evm.jsonl`, `activity-tron.jsonl`, `activity-solana.jsonl`.

## Gateway only

```bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-gateway.sh | bash
./start-onchain-invoice-gateway.sh
```

## Auto-update (optional per role)

Host cron pulls GHCR `:main` images and recreates containers only when the image digest changed. Sweeper updates use `docker stop -t` so an in-flight sweep can finish before recreate.

On small VPS hosts (≈1 GB), overlapping `docker pull` can wedge Docker. Install scripts harden that path:

- **Host flock** (`UPDATE_LOCK_FILE`, default `/var/lock/tc-auto-update.lock`): only one api/nodes/gateway update runs at a time; busy crons log and exit 0.
- **Digest-gated pull**: `docker buildx imagetools inspect` vs local `RepoDigest` — skip pull when unchanged.
- **Staggered cron**: api at `:00`, nodes at `:10`, gateway at `:20` (defaults **30m** / **30m** / **20m**).
- Prefer **`/etc/cron.d/tc-<role>-<dir>`** when writable (persists for Docker-helper installs); else user crontab.
- Gateway pulls UI/nginx **before** any `docker stop`, so a failed pull cannot leave the site down.

| Flag | Container | Default | Interval env |
|------|-----------|---------|--------------|
| `UI_TESTNET_AUTO_UPDATE` | `testnet-ui` | on | `GATEWAY_AUTO_UPDATE_INTERVAL_MIN` (20m @ :20) |
| `UI_MAINNET_AUTO_UPDATE` | `mainnet-ui` | on | same cron |
| `GATEWAY_AUTO_UPDATE` | nginx gateway | on | same cron |
| `NODES_AUTO_UPDATE` | sweeper compose (`onchain-invoice-sweeper-*` or `mainnet-sweeper-*`) | on | `NODES_AUTO_UPDATE_INTERVAL_MIN` (30m @ :10) |
| `API_AUTO_UPDATE` | API (`testnet-api` / `mainnet-api` via `DOCKER_NAME`) | **off** in testnet example; **on** in `deploy/.env.mainnet.api.example` | `API_AUTO_UPDATE_INTERVAL_MIN` (30m @ :00) |

```bash
# After editing flags in .env (and for mainnet dirs too):
cd /root/tc/gateway && ./install-auto-update.sh
cd /root/tc/sweeper && ./install-auto-update.sh
cd /root/tc/sweeper-mainnet && ./install-auto-update.sh
cd /root/tc/api && ./install-auto-update.sh
cd /root/tc/api-mainnet && ./install-auto-update.sh

# Prefer host cron.d when installing via Docker helper:
docker run --rm -v /root/tc:/root/tc -v /etc/cron.d:/etc/cron.d -v /var/run/docker.sock:/var/run/docker.sock \
  -w /root/tc/api-mainnet docker:27-cli sh -c 'apk add --no-cache bash >/dev/null && ./install-auto-update.sh'

# Host log:
tail -f /root/tc/gateway/logs/auto-update.log /root/tc/api-mainnet/logs/auto-update.log
```

`install-auto-update.sh` writes `/etc/cron.d/tc-<role>-<dir>` when that directory is writable (so cron survives ephemeral Docker install helpers). Otherwise it falls back to the invoking user's crontab.

Installers refresh cron from these flags (no `ROLE=` required). Legacy `AUTO_UPDATE` is still accepted if the role flag is unset.

Mainnet sweepers must use `SWEEPER_IMAGE=ghcr.io/naiemk/trustless-commerce-sweeper:main` (not a local-only tag) and `COMPOSE_FILE=docker-compose.sweepers-mainnet.yml` so auto-update recreates `mainnet-sweeper-evm` / `mainnet-sweeper-tron`. On a Docker-helper VPS you can sync scripts + cron with `deploy/install/wire-host-auto-update.sh`.

### Memory caps (1 GB host defaults)

Override in `.env` if needed:

| Env | Default | Applied via |
|-----|---------|-------------|
| `API_MEMORY_LIMIT` | `384m` | `docker create --memory` |
| `SWEEPER_MEMORY_LIMIT` | `192m` | compose `mem_limit` / single-container `--memory` |
| `UI_MEMORY_LIMIT` | `64m` | `docker run --memory` |
| `GATEWAY_MEMORY_LIMIT` | `64m` | `docker run --memory` |

### Solana sweeper (optional)

Testnet compose puts `sweeper-solana` behind profile `solana`. Default **`SWEEPER_SOLANA_ENABLED=0`** — start/update skip that service and remove it if left running. Set `SWEEPER_SOLANA_ENABLED=1` when Devnet program + keys are ready. Mainnet compose has no Solana service.

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
