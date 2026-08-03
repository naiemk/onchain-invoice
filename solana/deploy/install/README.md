# Solana node install helpers

Place Solana-only install scripts here (parallel to `/deploy/install`, not shared).

For now use:

```bash
cp solana/deploy/env.devnet.example solana/deploy/.env
# fill SOLANA_* and register sweeper with chains including devnet
docker compose -f solana/deploy/docker-compose.sweeper.yml --env-file solana/deploy/.env up -d
```
