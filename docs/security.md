# Security

Hosted **simple wallet** mainnet bar (recoverability + fund safety, IdentityStore operator, CI/audit roadmap): [Simple wallet mainnet assurance](wallet-mainnet-assurance.md).

- Sweepers never open the product DB; all updates go through the signed API
- Admin routes require `ADMIN_API_KEY`
- Admin UI is not in the public nav; still requires a valid key
- nginx + app rate limits (default 1 invoice create/s per IP)
- CORS allowlist via server YAML / `CORS_ORIGINS`
- Claim leases prevent double-sweep races between workers
- Follow-up: merchant API keys / captcha on create; Redis rate limits for multi-replica

## Wallet client HMAC

- Partner `hmacSecret` is shown once at create/rotate; store server-side only (never in frontend)
- Requests use timestamp skew (±5 min), nonce replay table, and body SHA-256 binding
- WebAuthn assertions must match the client `rpId` / `origins`; wallets are scoped to `(clientId, email)`
- Recovery trusts the partner as IdP (`identityVerified: true`); Commerce does not send verification email
- Challenges expire (~5 min) and are single-use
- Cross-client list isolation: client B cannot see client A’s wallets for the same email
- Guardian private key lives on the wallet-deployer worker, not in the HTTP API process

## Hosted identity wallet (certified simple path)

New hosted `/wallet` users use **IdentityWallet** + **IdentityStore** (not `Wallet.sol` owners). Program of record: [Simple wallet mainnet assurance](wallet-mainnet-assurance.md).

- Spend: EntryPoint v0.9 UserOp → `IdentityStore.verify` must return the wallet’s `identityId`
- Methods: WebAuthn, YubiKey, EOA on the identity. `disableRestore` is permanent and EOA-gated
- Email OTP starts a recovery **request** only; on-chain restore is `recoveryOperator` (`initiateRestore` → delay → `executeRestore`). Operator is a reco 2-of-3 Super Wallet (operator infrastructure; user Super remains beta)
- Existing methods can `cancelRestore` during the delay and can `addMethod` even after `disableRestore`
- Counterfactual address salt: `keccak256(abi.encode("TC-IDENTITY-WALLET-V1", identityId, index))`
- `IDENTITY_RESTORE_ENABLED` is a test override of on-chain `restoreEnabled`; do not set it on mainnet
- Super Wallet (`enableSuper`) is **beta / not fully audited**. It does **not** call `disableRestore` (unlike legacy `enableAdvanced`)

## Hosted wallet recovery (legacy AdminGuardian)

Distinct from IdentityStore operator restore **and** from the HMAC partner flow (`identityVerified` IdP attestation). Applies to **legacy** `Wallet.sol` clones with `AdminGuardianRecovery`:

- Hosted `/api/wallet/email*` + `/api/wallet/recovery*` use **email OTP** (Resend when `RESEND_API_KEY` is set; otherwise logged in dev)
- Email-first recovery: OTP, then list wallets; mutating routes require Turnstile when `TURNSTILE_SECRET` is set
- Recovery without email is allowed (wallet address + new key). Ops is emailed `recovery requested` when `WALLET_RECOVERY_NOTIFY_EMAIL` is set
- Recover-without-email EOA proof is EIP-712 `Recover(address wallet, string challenge, address signer)` (same domain as Connect wallet). Leftover EIP-191 `personal_sign` recovery messages are rejected
- If that EOA is already an on-chain owner (simple sentinel or Super Wallet `KEY_EOA`), the client self-enrolls a new passkey with an EOA-signed UserOp (`addOwner` / `addKey`). New EOAs still go to guardian review and are **not** initiated on-chain (P256-only `AdminGuardianRecovery`)
- Passkey assertions use the **hosted** WebAuthn `rpId` (API/public hostname), not a partner domain
- Guardian dashboard `/guardian` (not in nav): MetaMask signs an EIP-191 login; only the on-chain `AdminGuardianRecovery.guardian` EOA (or `WALLET_ADMIN_GUARDIAN` fallback) may approve/reject
- Approve enqueues a `wallet_recovery_jobs` initiate; the deployer still holds `guardianPrivateKey`
- OTP codes are SHA-256 hashed at rest; never returned in HTTP JSON

Identity wallets reuse the same hosted request rows; initiation is IdentityStore (`recoveryOperator` / reco Super), not `initiateOwnerRecovery`.

## Wallet EOA owners (Connect wallet)

Identity wallets add an EOA as an IdentityStore method (`METHOD_EOA`) and sign EIP-712 `Verify` / `AddMethod` against the store. Legacy `Wallet.sol` still uses the owner sentinels below.

- Simple **legacy** wallets add a connected EOA via `addOwnerEoa` (EIP-712 `AddOwner`); the address is stored as a sentinel `qx`/`qy` owner and can sign UserOps with EIP-712 `UserOp(bytes32 userOpHash)`
- Super Wallets add `KEY_EOA` on the current identity via `addKeyEoa` (EIP-712 `AddKey`)
- Domain: name `Trustless Commerce Wallet`, version `1`, `chainId`, `verifyingContract` = wallet
- `WalletFactory.walletImplementation` is **immutable**. Existing clones keep the bytecode they were created with (P256-only / EIP-191 EOA). New EOA-owner / EIP-712 validation requires a **new** implementation and factory; update `WALLET_FACTORY_ADDRESS` after redeploy
- Deploy `WalletEip712` first and link it when compiling/deploying `Wallet` (`scripts/deploy-wallet.ts`)
