# Testnet wallet recovery runbook

Use after deploying unlock fixes + local recovery + persist-log.

## 1. Deploy API with persist-log

Ensure `.env` on testnet API includes:

```bash
PERSIST_LOG_DIR=./persist-logs
```

Restart API (`./start-api.sh`).

## 2. Backfill existing wallets (including naiem's super)

```bash
cd ~/services/tctest-api   # your install dir
DB_PATH=./data/trustless-commerce.db PERSIST_LOG_DIR=./persist-logs \
  npm run wallet:persist:backfill
```

## 3. Recover naiem's super via UI

1. Open wallet home → tap **naiem's super** (or **Unlock wallet from device**)
2. If unlock fails, **Local Recovery** opens automatically
3. **If DB row exists:** Retry passkey (pinned to this wallet)
4. **If DB row missing but deployed:** Enter Sepolia + wallet address → **Recover from chain**
5. **If undeployed with funds:** Copy support request from the sheet; operator replays persist-log and redeploys

## 4. Verify

```bash
curl -s "https://testnet.trustless-commerce.com/api/wallet/accounts/0xYOUR_ADDRESS" | jq .
curl -s "https://testnet.trustless-commerce.com/api/wallet/accounts/0xYOUR_ADDRESS/recover-info?chainId=11155111" | jq .
```
