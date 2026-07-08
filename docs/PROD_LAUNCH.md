# FastSwap production launch runbook

## Architecture

- **UI**: static files in [`app/fastswap/ui/`](../app/fastswap/ui/) on Vercel (`FASTSWAP_API_BASE` → public API URL).
- **API**: Docker [`docker/compose/api.yml`](../docker/compose/api.yml) on VPS.
- **Nodes**: Docker [`docker/compose/nodes.yml`](../docker/compose/nodes.yml) (sweep, relay, liqman) on same VPS or private network.
- **Config**: [`FastSwapConfig.yaml`](../FastSwapConfig.yaml) — single source of truth for chains, tokens, liquidity, contract addresses.
- **Secrets**: `.env` only — private keys, `API_SIGNING_SECRET`, RPC URLs, router addresses.

## 1. Prepare environment

```bash
cp .env.example .env
cp docker/compose/.env.example docker/compose/.env
```

Fill all values. Set `server.publicUrl` in `FastSwapConfig.yaml` to your public API URL. Enable captcha in YAML only after Cloudflare Turnstile keys are set.

## 2. Edit config

- Set `active-chains`, token definitions, liquidity bands, and deploy salts (`namespace` / `version`).
- Leave `deploy.contracts` empty until deploy completes.

## 3. Predict addresses

```bash
npm run fastswap:cli:predict
```

## 4. Deploy contracts

```bash
npm run fastswap:cli -- --deploy-evm-all
npm run fastswap:cli -- --deploy-tron
```

Addresses are written incrementally to `FastSwapConfig.yaml`.

## 5. Post-deploy configure (EVM examples)

Grant roles to operational wallets (revoke from deployer where appropriate):

```bash
npm run fastswap:cli -- --configure-role --chain base --role RELAYER_ROLE --account 0x...
npm run fastswap:cli -- --configure-role --chain base --role SWEEPER_ROLE --account 0x...
```

Allow LiquidityManager router and aggregators:

```bash
npm run fastswap:cli -- --configure-router --chain base --router 0x...
npm run fastswap:cli -- --configure-aggregator --chain base --aggregator 0x...
```

Set liquidity floors and seed native liquidity:

```bash
npm run fastswap:cli -- --configure-floor --chain base --token NATIVE --amount 20000000000000000
npm run fastswap:cli -- --configure-liquidity --chain base --amount 100000000000000000
```

Smoke-test pause/unpause:

```bash
npm run fastswap:cli -- --configure-pause --chain base
npm run fastswap:cli -- --configure-unpause --chain base
```

## 6. Validate and verify

```bash
npm run fastswap:cli -- --validate
npm run fastswap:cli:verify
```

Tron explorer verification is manual.

## 7. Start Docker services

From repo root (ensure `FastSwapConfig.yaml` is filled and `docker/compose/.env` is set):

```bash
npm run docker:build
npm run docker:up:api
npm run docker:up:nodes
```

Check API health:

```bash
curl -s http://localhost:4010/health
```

## 8. Deploy UI (Vercel)

- Root or output directory: `app/fastswap/ui`
- Environment: `FASTSWAP_API_BASE=https://your-api.example.com`
- Set `CORS_ORIGIN` on the API to your Vercel origin.

## 9. Testnet smoke

1. `POST /quotes` → receive quote
2. `POST /invoices` → receive signed invoice + payment address
3. Pay on source chain
4. Confirm sweep node marks paid; relay completes on target
5. Confirm invoice status reaches `complete`

## Accepted launch risks

| Risk | Mitigation |
|------|------------|
| Trusted relayer (`RELAYER_ROLE`) | Dedicated hot wallet, monitoring, pause, minimal balance |
| Customer funds commingled with liquidity | Pause + `adminSweep` above floor; ops runbook |
| No on-chain refund path | Manual refund to `refundAddress` via ops |

See [TESTNET.md](TESTNET.md) for Sepolia + BSC testnet + Nile step-by-step bootstrap.

## Audit logs

Per-service append-only JSONL under `./data/` (configurable in YAML). Replay/merge with `scripts/audit-merge.ts`.
