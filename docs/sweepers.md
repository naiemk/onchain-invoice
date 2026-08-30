# Nodes (sweepers, bundler, wallet-deployer)

Testnet nodes install runs several workers from **one** Docker image: `ghcr.io/<org>/trustless-commerce-sweeper` (built on every `main` push). Compose overrides `command` for non-sweeper roles.

| Service | Role |
| --- | --- |
| `sweeper-evm` / `sweeper-tron` (+ optional `sweeper-solana`) | Detect → claim → track paid → sweep → track swept |
| `bundler-evm` | Poll pending UserOps → EntryPoint `depositTo` (gas) → `handleOps` |
| `wallet-deployer-evm` | When undeployed wallet has USDC → `WalletFactory.createAccount` |

## Sweeper

- Register wallet: `POST /api/admin/sweepers` with admin key (`./register-onchain-invoice-node.sh`)
- Sign every request with that wallet
- **Claim** before broadcasting on-chain (`claimed_by` / `claimed_until` lease)
- **Optimistic version** on every write; retry on 409

Config: `onchain-invoice-nodes.yaml` (from `commerce/config/sweeper.example.yaml`).

## Bundler

- Register: `POST /api/admin/bundlers` (`./register-onchain-invoice-bundler.sh`)
- Signed bundler headers on claim/track/list
- Constant USDC fee in UserOp batch; bundler EOA pays ETH gas + tops up EntryPoint deposit for USDC-only wallets
- API must expose `WALLET_BUNDLER_BENEFICIARY` via env so the UI can build fee batches

Config: `onchain-invoice-bundler.yaml`.

## Wallet deployer

- Uses sweeper API key against `GET /api/wallet/deployer/accounts` and `PATCH …/deployed`
- Needs `WALLET_FACTORY_ADDRESS` + funded `WALLET_DEPLOYER_PRIVATE_KEY` (often same as sweeper key)
- Also polls `GET /api/internal/wallet-recovery/jobs` and runs guardian recovery:
  - `initiate` → `AdminGuardianRecovery.initiateOwnerRecovery`
  - `cancel` → `Wallet.cancelPendingOwnerWithSignature`
  - after timelock → `executeOwnerRecovery`
- Optional per-chain `guardianPrivateKey` (defaults to deployer key) and `recoveryAddress`

Config: `onchain-invoice-wallet-deployer.yaml`.

Empty/`_PRIVATE_KEY_` placeholders soft-skip so containers stay up until keys are filled.

Partner HMAC wallet API (create/list/send/recover): [Wallet client API](wallet-client-api.md).
