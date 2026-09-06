# Persist-logs (disaster recovery)

Trustless Commerce API writes **append-only domain events** to `PERSIST_LOG_DIR` (mounted as `/persist-logs` in the API container). After SQLite is lost, replay this directory into a new database so passkey wallets and unpaid invoices can be found again.

On-chain key recovery (`WalletFactory` / `recover-from-chain`) only works **after** `createAccount`. If the wallet was never deployed and USDC is still on an invoice forwarder, **the only recovery path is persist-log** (wallet public keys + invoice seed/address).

## VPS setup

1. **API `.env`** — `PERSIST_LOG_DIR=./persist-logs` (see `env_api.tctest.example`)
2. **Machine shipper** — vibed-infra `install-persist-logs.sh` once on the VPS
3. **Off-host backup** — `PERSIST_SHIP=1` + R2 credentials in `~/services/vibed-infra/persist-logs/.env`

## One-time backfill

```bash
DB_PATH=./data/trustless-commerce.db PERSIST_LOG_DIR=./persist-logs npm run persist:backfill
```

(`wallet:persist:backfill` is the same command.)

## Disaster replay

```bash
DB_PATH=./data/trustless-commerce-restored.db PERSIST_LOG_DIR=./persist-logs npm run persist:replay
```

Then point the API at the restored DB, **re-register sweepers** (`POST /api/admin/sweepers` / `register-onchain-invoice-node.sh`), and start **sweeper + wallet-deployer**. Replay restores wallet coordinates and invoice rows; it does not restore sweeper registrations, sessions, or OTPs.

(`wallet:persist:replay` now replays **wallet + invoice** streams. Wallet-only replay cannot locate unswept invoice forwarders.)

## Logged events

### Stream `wallet`

| Type | Critical fields |
|------|-----------------|
| `account.created` | address, salt, ownerQx, ownerQy, credentialId |
| `account.deployed` | address, chainId |
| `account.credential_updated` | address, credentialId |
| `device.registered` | walletAddress, chainId, ownerQx, ownerQy |
| `device.removed` | walletAddress, chainId, ownerQx, ownerQy |
| `email.verified` | walletAddress, email |
| `entity.registered` | walletAddress, entityId |
| `entity_key.registered` | walletAddress, entityId, keyId, qx, qy |

### Stream `invoice`

| Type | Critical fields |
|------|-----------------|
| `invoice.created` | invoiceId, invoiceSeed, selectedTo, toAddresses, chainId, token, invoiceAddress, priceUsd |
| `invoice.paid` | invoiceId, status, amountPaid |
| `invoice.swept` | invoiceId, amountSwept, sweepTx |

`invoice.created` is what locates money stuck on a forwarder after a DB wipe.

## Tests

- **Unit:** `npx hardhat test test/CommerceWalletPersistLog.ts`
- **In-mem e2e (Hardhat + real sweeper/deployer workers):** included in `npm test` via `test/CommercePersistRecoveryE2e.ts` (16 wallets × 10 invoices, all sweeper × deployer permutations). Wipe SQLite, replay persist-log, drain funds, deploy wallets, create+pay+sweep a new invoice on each restored wallet, then **send all remaining USDC from each holder wallet to a collection address** via `Wallet.execute` (EntryPoint).
- **UI WebAuthn:** `npx playwright test ui/e2e/persist-recovery.spec.ts` (virtual authenticator, 16 × 10, replay keys + invoices, then create a new invoice from the restored DB)
- **Sepolia:** `npm run test:live-persist-recovery` (`LIVE_PERSIST_RECOVERY=1`; 6 wallets × 6 invoices, same four permutations, plus a reuse payment after recovery)
