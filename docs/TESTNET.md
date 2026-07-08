# Testnet bootstrap (Sepolia + BSC testnet + TRON Nile)

Run the CLI **step by step** with one funded operator wallet. Copy [`.env.testnet.example`](../.env.testnet.example) to `.env`, fill RPC URLs and keys, then:

```bash
npm run fastswap:testnet -- --step env
npm run fastswap:testnet -- --step deploy-evm
npm run fastswap:testnet -- --step deploy-tron
npm run fastswap:testnet -- --step deploy-tokens
npm run fastswap:testnet -- --step configure-all
npm run fastswap:testnet -- --step seed
npm run fastswap:testnet -- --step validate
npm run fastswap:testnet -- --step smoke
```

Optional: `npm run fastswap:testnet -- --step liqman-once` after seed (see LiquidityManager below).

## Single wallet

Set only `EVM_PRIVATE_KEY` (and `TRON_PRIVATE_KEY` if different — can be the same hex). The CLI copies it to `SWEEP_*`, `RELAY_*`, and `LM_PRIVATE_KEY` automatically.

Your wallet needs testnet gas on all three networks:
- Sepolia ETH
- BSC testnet BNB
- Nile TRX

## LiquidityManager — does it buy USDT automatically?

**Yes, but only after initial seeding and configuration.**

| Phase | What happens |
|-------|----------------|
| **`seed` step** | Mints test USDT (MockERC20), deposits USDT into the **LiquidityManager reserve**, and adds native + stable liquidity to each **FastSwap receiver** at YAML `target` levels. |
| **`liqman-once` / running bot** | Scans receiver balances vs YAML bands (`floor` / `target` / `ceiling`). When a token drops **below floor**, the bot refills toward `target`: stable tokens are **pushed from the LM USDT reserve**; volatile tokens (ETH/BNB/TRX) are **bought via OpenOcean** (USDT→volatile) then pushed to the receiver. When above **ceiling**, excess is pulled and swapped back to USDT. |
| **Queued swaps** | If a customer swap queues for lack of target liquidity, the bot can push from reserve and call `processQueued`. |

**Requirements for auto buy/sell:**
1. `--step configure-all` completed (LM contract has `REBALANCER`/`LIQUIDITY` on receivers; router allowlisted).
2. LM reserve holds USDT (`seed` step).
3. `LM_PRIVATE_KEY` wallet has gas on that chain.
4. OpenOcean returns routes on that network (testnet DEX liquidity is thin — **seed** is the reliable path on Nile/Sepolia/BSC testnet).

On testnet, **`seed` + smoke test** proves the product path; **`liqman-once`** validates rebalancing when OpenOcean has routes.

## Routers

Set `SEPOLIA_ROUTER_ADDRESS`, `BSC_TESTNET_ROUTER_ADDRESS`, and `TRON_ROUTER_ADDRESS` in `.env` to OpenOcean-whitelisted router targets for each network. Required for `configure-all` and LM swaps; not needed for the smoke test if targets are pre-seeded.

## Config file

[`FastSwapConfig.testnet.yaml`](../FastSwapConfig.testnet.yaml) — separate CREATE2 namespace (`fastswap-testnet/1`) so testnet addresses do not collide with mainnet.
