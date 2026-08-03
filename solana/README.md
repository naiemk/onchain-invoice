# Solana (Trustless Commerce)

Separated Solana infra for destination-bound invoice settle. EVM/Tron stay under `/contracts`, `/deploy`, and `/commerce` as before.

## Layout

```text
solana/
  programs/commerce-invoice/   # native SBF program (PDA settle)
  target/deploy/               # .so + program keypair (build artifact)
  config/                      # sweeper YAML example
  deploy/                      # Solana-only compose / env (not /deploy)
  data/                        # deploy artifacts JSON
  e2e/                         # success-test runner scripts
  README.md
```

## Program model

- Invoice PDA seeds: `["invoice", invoice_id_32, merchant_pubkey]`
- Payers send USDC to the PDA's associated token account (stored as `invoiceAddress`)
- `settle` (authority-signed) pays **only** the bound merchant (+ fee) and closes the ATA
- Sweeper cannot redirect funds (wrong merchant ⇒ different empty PDA)

## Build

```bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd solana/programs/commerce-invoice && cargo-build-sbf
```

## Success tests (required)

```bash
# from repo root — starts solana-test-validator if RPC is down
npm run solana:test
```

Covers: stable ATA prediction, pay→settle balances, wrong-merchant no-drain, unauthorized sweeper rejected.

## Config

API (`commerce/config/server.example.yaml`):

```yaml
solana:
  rpcUrl: ${SOLANA_RPC_URL}
  programId: ${SOLANA_PROGRAM_ID}
  usdcMint: ${SOLANA_USDC_MINT}
```

Sweeper: [`config/sweeper.example.yaml`](config/sweeper.example.yaml) with `SWEEPER_ROLE=solana`.

Compose: [`deploy/docker-compose.sweeper.yml`](deploy/docker-compose.sweeper.yml) — do not mix into `/deploy/install/docker-compose.sweepers.yml`.

Env template: [`deploy/env.devnet.example`](deploy/env.devnet.example).
