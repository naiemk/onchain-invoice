# Solana install notes

**Prefer the unified nodes installer** (Sepolia + Nile + Solana Devnet in one compose):

```bash
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-nodes.sh | bash
```

See [`deploy/install/README.md`](../../../deploy/install/README.md).

This directory is reserved for optional Solana-only helpers. For a Solana-only compose (not the VPS default):

```bash
cp solana/deploy/env.devnet.example solana/deploy/.env
# fill SOLANA_*; copy solana/config/sweeper.example.yaml → solana/deploy/solana-nodes.yaml
docker compose -f solana/deploy/docker-compose.sweeper.yml --env-file solana/deploy/.env up -d
```
