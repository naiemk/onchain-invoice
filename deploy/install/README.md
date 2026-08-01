# Operator install (wget | bash)

Bootstrap API or sweeper-node configs and start scripts on any host with Docker.

## API

```bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-api.sh | bash
# or: curl -fsSL .../install-api.sh | bash
```

Creates (if missing):

- `onchain-invoice-api.yaml` — docker image + API settings
- `start-onchain-invoice-api.sh` — `docker pull` + `docker run`

```bash
# edit yaml, then:
./start-onchain-invoice-api.sh
```

## Sweeper nodes

```bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-nodes.sh | bash
```

Creates (if missing):

- `onchain-invoice-nodes.yaml` — docker image + worker settings
- `start-onchain-invoice-nodes.sh`

```bash
./start-onchain-invoice-nodes.sh
```

## Notes

- Existing config/start files are **not** overwritten.
- `docker.image` in each YAML selects the GHCR tag (`:main` by default).
- `${ENV}` placeholders in YAML are expanded by the container at runtime; export vars before starting.
- Linux: start-nodes adds `host.docker.internal` → host gateway so `serverUrl: http://host.docker.internal:8080` works.
- Optional: `INSTALL_DIR=/opt/tc bash install-api.sh` to install into another directory.
- Dev against a branch: `ONCHAIN_INVOICE_RAW=https://raw.githubusercontent.com/naiemk/onchain-invoice/<ref>/deploy/install bash install-api.sh`
