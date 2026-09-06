# Testnet wallet recovery runbook

Use after deploying unlock fixes + local recovery + persist-log.

## 1. Deploy API with persist-log

Ensure `.env` on testnet API includes:

```bash
PERSIST_LOG_DIR=./persist-logs
```

Restart API (`./start-api.sh`).

## 2. Backfill existing wallets and invoices

```bash
cd ~/services/tctest-api   # your install dir
DB_PATH=./data/trustless-commerce.db PERSIST_LOG_DIR=./persist-logs \
  npm run persist:backfill
```

## 3. Recover naiem's super via UI

1. Open wallet home → tap **naiem's super** (or **Unlock wallet from device**)
2. If unlock fails, **Local Recovery** opens automatically
3. **If DB row exists:** Retry passkey (pinned to this wallet)
4. **If DB row missing but deployed:** Enter Sepolia + wallet address → **Recover from chain**
5. **If undeployed with funds still in an invoice:** persist-log is required. On-chain lookup cannot find the forwarder (random `invoiceSeed`) and cannot read the passkey until `WalletFactory.createAccount`. Operator:
   1. Restore `PERSIST_LOG_DIR` (local or R2 ship)
   2. `npm run persist:replay` into a new `DB_PATH`
   3. Point API at the restored DB and restart
   4. Re-register the sweeper (`register-onchain-invoice-node.sh`)
   5. Start **sweeper** then **wallet-deployer** so unswept invoices drain to the wallet and the account is deployed

## 4. Verify

```bash
curl -s "https://testnet.trustless-commerce.com/api/wallet/accounts/0xYOUR_ADDRESS" | jq .
curl -s "https://testnet.trustless-commerce.com/api/wallet/accounts/0xYOUR_ADDRESS/recover-info?chainId=11155111" | jq .
curl -s "https://testnet.trustless-commerce.com/api/invoices/INVOICE_ID" | jq .
```

## Automated recovery suite

| Level | Command |
|-------|---------|
| In-mem Hardhat (CI) | `npx hardhat test test/CommercePersistRecoveryE2e.ts` (also part of `npm test`; 16×10, 4 sweeper×deployer permutations, reuse after recovery, then collect USDC from each wallet) |
| Mock WebAuthn UI | `npx playwright test ui/e2e/persist-recovery.spec.ts` (16×10, replay then new invoice on restored API) |
| Sepolia | `LIVE_PERSIST_RECOVERY=1 npm run test:live-persist-recovery` (6×6, same four permutations) |

Need `SEPOLIA_RPC_URL`, `EVM_PRIVATE_KEY` (gas + Sepolia USDC), `SWEEPER_ADDRESS`, and `FORWARDER_IMPLEMENTATION`. The live harness starts a **local** API with persist-log so it can delete SQLite and replay; it does not wipe hosted testnet.
