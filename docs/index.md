# Trustless Commerce

Crypto invoices with deterministic on-chain payment addresses. Merchants share a pay link; customers pay USDC (stablecoins only at launch); a sweeper settles to the merchant wallet.

- **UI:** Vercel (`ui/` in this repo)
- **API + sweeper:** `commerce/` in this repo (Docker images via `deploy/`)
- **Docs source:** this MkDocs site

!!! note "EVM launch"
    Launch targets EVM (e.g. Sepolia / mainnet). Tron and Solana sweepers are not implemented yet.

Product sequence (Base/Tron/Solana testnets → mainnet → ops → agent docs → audit): [ROADMAP.md](https://github.com/naiemk/onchain-invoice/blob/main/ROADMAP.md).
