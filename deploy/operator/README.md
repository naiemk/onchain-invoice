# Local deploy console (operator)

Wallet-signed, config-driven deploys for Trustless Commerce. **Localhost only** — not for VPS/gateway.

## What it does

1. Reads `deploy/operator/config.yaml` (seed + public addresses — **no private keys**).
2. Plans EVM `CommerceInvoiceSweeper` via **CREATE2** (Nick factory `0x4e59…`) so the sweeper address is determined by `seed + chainId + feeRecipient + feeBps + owner`.
3. You connect **MetaMask** (gas payer only). Owner / fee recipient stay as addresses in the config (hardware wallet / multisig OK).
4. Deploy + optional Hardhat verify; CLI stdout/stderr stream into the UI.
5. Writes `sweeper` / `forwarderImplementation` back into `config.yaml`.
6. Solana: build via CLI stream, record `programId` / authority pubkeys in config (Tron needs no contract deploy).

## Setup

```bash
cp deploy/operator/config.example.yaml deploy/operator/config.yaml
# edit seed, feeRecipient, owner (non-zero addresses)
npm run deploy:console
```

Open http://127.0.0.1:5179

## Security model

| In config.yaml | Not in config.yaml |
|----------------|--------------------|
| CREATE2 seed (salt material) | EVM private keys |
| feeRecipient / owner addresses | Mnemonics |
| Deployed contract addresses | Solana fee-payer secrets |

The MetaMask account only needs gas. It does **not** have to be `owner`.

## After deploy

Copy addresses into API / nodes env:

- Sepolia: `SWEEPER_ADDRESS` / `FORWARDER_IMPLEMENTATION` ← `chains.sepolia.*`
- Base: `EVM_8453_SWEEPER_ADDRESS` / `EVM_8453_FORWARDER_IMPLEMENTATION` ← `chains.base.*`
- BNB: `EVM_56_SWEEPER_ADDRESS` / `EVM_56_FORWARDER_IMPLEMENTATION` ← `chains.bsc.*`
- `SOLANA_PROGRAM_ID` ← `solana.programId` (after program deploy + initialize)

## Mainnet launch checklist (Tron + Base + BNB)

1. `npm run deploy:console` → CREATE2 deploy **Base** (`8453`) and **BNB** (`56`) with the same seed / owner / feeRecipient.
2. Fill mainnet API `.env` with the two sweeper/forwarder pairs + Tron master secret + `TRON_USDT_ADDRESS=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` + `TRON_FULL_HOST=https://api.trongrid.io`.
3. Fill sweeper `.env` / YAML; set `SWEEPER_CHAINS=8453,56,tron` and `TRON_CHAIN_ID=tron`; register the sweeper.
4. Build/serve UI with `VITE_DEPLOYMENT_MODE=mainnet` (or a hostname without `testnet.`).
5. Smoke: create invoice per chain → pay a small amount → confirm sweep.

Out of scope for the prep PR: live CREATE2, committing real mainnet addresses, Solana mainnet, Ethereum/Arbitrum settlement.

## Notes

- CREATE2 factory must exist on the target chain (it does on Sepolia / Ethereum / Base / BNB / most L2s).
- Hardhat verify needs `@nomicfoundation/hardhat-verify` (installed) and ideally `ETHERSCAN_API_KEY` in the repo-root `.env` for Etherscan. Networks `base` and `bsc` are defined in `hardhat.config.ts` (RPC from `BASE_RPC_URL` / `BSC_RPC_URL` or `EVM_8453_RPC_URL` / `EVM_56_RPC_URL`). Sourcify/Blockscout still attempt without a key.
- Solana **program** deploy still uses the in-repo program keypair for the fixed program id; set authority pubkey in config and run `npm run solana:deploy:devnet` (or extend this console) with a funded authority — never put that secret in `config.yaml`.
