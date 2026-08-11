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

- `SWEEPER_ADDRESS` ← `chains.<name>.sweeper`
- `FORWARDER_IMPLEMENTATION` ← `chains.<name>.forwarderImplementation`
- `SOLANA_PROGRAM_ID` ← `solana.programId` (after program deploy + initialize)

## Notes

- CREATE2 factory must exist on the target chain (it does on Sepolia / Ethereum / most L2s).
- Hardhat verify needs the usual explorer API key in the environment when you press Verify.
- Solana **program** deploy still uses the in-repo program keypair for the fixed program id; set authority pubkey in config and run `npm run solana:deploy:devnet` (or extend this console) with a funded authority — never put that secret in `config.yaml`.
