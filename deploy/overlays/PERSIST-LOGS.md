# Wallet persist-logs (disaster recovery)

Trustless Commerce API writes **append-only wallet events** to `PERSIST_LOG_DIR` (mounted as `/persist-logs` in the API container).

## VPS setup

1. **API `.env`** — `PERSIST_LOG_DIR=./persist-logs` (see `env.api.tctest.example`)
2. **Machine shipper** — vibed-infra `install-persist-logs.sh` once on the VPS
3. **Off-host backup** — `PERSIST_SHIP=1` + R2 credentials in `~/services/vibed-infra/persist-logs/.env`

## One-time backfill

```bash
DB_PATH=./data/trustless-commerce.db PERSIST_LOG_DIR=./persist-logs npm run wallet:persist:backfill
```

## Disaster replay

```bash
DB_PATH=./data/trustless-commerce-restored.db PERSIST_LOG_DIR=./persist-logs npm run wallet:persist:replay
```

## Logged events (stream: `wallet`)

| Type | Critical fields |
|------|-----------------|
| `account.created` | address, salt, ownerQx, ownerQy, credentialId |
| `account.deployed` | address, chainId |
| `device.registered` | walletAddress, chainId, ownerQx, ownerQy |
| `email.verified` | walletAddress, email |
| `entity.registered` | walletAddress, entityId |
| `entity_key.registered` | walletAddress, entityId, keyId, qx, qy |
