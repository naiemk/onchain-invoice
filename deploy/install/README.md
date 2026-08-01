# Operator install (wget | bash)

Bootstrap API or sweeper-node configs and start scripts on any host with Docker.

## API

```bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-api.sh | bash
# or: curl -fsSL .../install-api.sh | bash
```

Creates (if missing):

- `onchain-invoice-api.yaml` — docker image + API settings (`${ENV}` placeholders)
- `start-onchain-invoice-api.sh` — pull/create/start container
- `.env.example` / `.env` — secrets and Sepolia defaults (`.env` is created once; never overwritten)

```bash
# edit .env, then:
./start-onchain-invoice-api.sh
```

## Sweeper nodes

```bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-nodes.sh | bash
```

Creates (if missing):

- `onchain-invoice-nodes.yaml`
- `start-onchain-invoice-nodes.sh`
- `register-onchain-invoice-node.sh` — `POST /api/admin/sweepers`
- `.env.example` / `.env`

```bash
# edit .env (API_URL, ADMIN_API_KEY, wallet, …)
./register-onchain-invoice-node.sh   # API must be up
./start-onchain-invoice-nodes.sh
```

Optional flags:

```bash
./register-onchain-invoice-node.sh --address 0x… --label dtn-node --chains 11155111
```

## Notes

- Existing config/start/`.env` files are **not** overwritten.
- Prefer editing **`.env`**; YAML uses `${ADMIN_API_KEY}` etc. Start scripts load `.env` for unset variables only (shell exports win).
- Empty env vars are **not** passed as `docker -e KEY=` (so they cannot wipe YAML / expanded config).
- `docker.image` in each YAML selects the GHCR tag (`:main` by default).
- Linux: start-nodes adds `host.docker.internal` → host gateway. Prefer `SERVER_URL=https://testnet.trustless-commerce.com` when the API is behind the public gateway.
- Optional: `INSTALL_DIR=/opt/tc bash install-api.sh` to install into another directory.
- Dev against a branch: `ONCHAIN_INVOICE_RAW=https://raw.githubusercontent.com/naiemk/onchain-invoice/<ref>/deploy/install bash install-api.sh`
- Skip image pull (local tags): `ONCHAIN_INVOICE_SKIP_PULL=1` or `PULL=0` before `./start-onchain-invoice-*.sh`.
- Start scripts `docker create` + `docker cp` the YAML into the container. Set `ONCHAIN_INVOICE_SKIP_HOST_MOUNTS=1` to store API data in a named Docker volume instead of `docker.dataDir` on the host.
- API data dir is chown'd to uid `1000` (`node` in the image) so root installs do not hit `SQLITE_CANTOPEN`.
- System coverage: `npm run system-test:install` (also runs after the compose suite in `npm run system-test`).
