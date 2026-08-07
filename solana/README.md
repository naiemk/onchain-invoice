# Solana (Trustless Commerce)

Solana program + SDK live under `solana/`. **Operator node install** (Sepolia + Nile + Solana) is the unified wget path under [`deploy/install/`](../deploy/install/) — one `docker-compose.sweepers.yml` with three services.

## Layout

```text
solana/
  programs/commerce-invoice/   # native SBF program (PDA settle)
  target/deploy/               # .so + program keypair (build artifact)
  config/                      # Solana-focused sweeper YAML example
  deploy/                      # optional Solana-only compose / env
  scripts/                     # deploy-devnet.sh
  data/                        # deploy artifacts JSON
  e2e/                         # local success tests + Devnet smoke
  README.md
```

## Program model

- Invoice PDA seeds: `["invoice", invoice_id_32, merchant_pubkey, mint]`
- Payers send SPL tokens (USDC/USDT) to the PDA's associated token account (stored as `invoiceAddress`)
- `settle` (authority-signed) pays **only** the bound merchant (+ fee) and closes the ATA
- Sweeper cannot redirect funds (wrong merchant or mint ⇒ different empty PDA)
- Config is keyed by `chainId` (`devnet` / `mainnet-beta`) with a `tokens` map — same code path for every network

## Build

```bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
npm run solana:build
```

## Success tests (local validator)

```bash
npm run solana:test
```

Covers: stable ATA prediction, pay→settle balances, wrong-merchant no-drain, unauthorized sweeper rejected.

## Devnet deploy + smoke

```bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
# Optional: SOLANA_SWEEPER_KEY='[…]' JSON byte array for a known authority
npm run solana:deploy:devnet
npm run solana:smoke:devnet
```

Writes `solana/data/commerce-deploy-devnet.json`. Put `SOLANA_PROGRAM_ID` / `SOLANA_SWEEPER_KEY` / `SOLANA_FEE_RECIPIENT` on both the API and nodes `.env`.

## VPS nodes (wget — all chains)

```bash
docker rm -f onchain-invoice-node \
  onchain-invoice-sweeper-evm onchain-invoice-sweeper-tron onchain-invoice-sweeper-solana 2>/dev/null || true

mkdir -p ~/tc/sweeper && cd ~/tc/sweeper
wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-nodes.sh | bash
# edit .env (see .env.example) then:
./register-onchain-invoice-node.sh
./start-onchain-invoice-nodes.sh
```

## Config

API: `commerce/config/server.example.yaml` (`solana.chains.devnet` / `mainnet-beta`).

Sweeper (unified install): `deploy/install/onchain-invoice-nodes.yaml` with `SWEEPER_ROLE=solana` on the Solana compose service.

Optional Solana-only compose remains under [`deploy/docker-compose.sweeper.yml`](deploy/docker-compose.sweeper.yml).
