# Trustless Commerce

Crypto invoices with deterministic on-chain payment addresses. Merchants share a pay link; customers pay USDC (stablecoins only at launch); a sweeper settles to the merchant wallet.

- **UI:** Vercel (`ui/` in this repo)
- **API + sweeper:** `commerce/` in this repo (Docker images via `deploy/`)
- **Docs source:** this MkDocs site

!!! note "Launch chains"
    Ethereum Sepolia (USDC) and TRON Nile (USDT) are live in product. Solana Devnet (USDC, PDA settle) is implemented under `solana/` — enable via `SOLANA_PROGRAM_ID` / sweeper role `solana`. See [ROADMAP.md](https://github.com/naiemk/onchain-invoice/blob/main/ROADMAP.md).

Product sequence (Base/Tron/Solana testnets → mainnet → ops → agent docs → audit): [ROADMAP.md](https://github.com/naiemk/onchain-invoice/blob/main/ROADMAP.md).

## Platform integrations

Ecommerce and creator adapters (WooCommerce, Shopify, Kajabi, Teachable) share one contract:

- [Platform integration contract](platform-integration.md)
- Plugins & SDKs in [`platforms/`](../platforms/)

## Wallet client API

Partners who embed passkey smart wallets on **their own domain** use the HMAC [Wallet client API](wallet-client-api.md) (not the hosted `/wallet` UI).
