# Security

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

## Hosted wallet recovery

Distinct from the HMAC partner flow (`identityVerified` IdP attestation):

- Hosted `/api/wallet/email*` + `/api/wallet/recovery*` use **email OTP** (Resend when `RESEND_API_KEY` is set; otherwise logged in dev)
- Email-first recovery: OTP, then list wallets; mutating routes require Turnstile when `TURNSTILE_SECRET` is set
- Recovery without email is allowed (wallet address + new key). Ops is emailed `recovery requested` when `WALLET_RECOVERY_NOTIFY_EMAIL` is set
- Recover-without-email EOA proof is EIP-712 `Recover(address wallet, string challenge, address signer)` (same domain as Connect wallet). Leftover EIP-191 `personal_sign` recovery messages are rejected
- If that EOA is already an on-chain owner (simple sentinel or Super Wallet `KEY_EOA`), the client self-enrolls a new passkey with an EOA-signed UserOp (`addOwner` / `addKey`). New EOAs still go to guardian review and are **not** initiated on-chain (P256-only `AdminGuardianRecovery`)
- Passkey assertions use the **hosted** WebAuthn `rpId` (API/public hostname), not a partner domain
- Guardian dashboard `/guardian` (not in nav): MetaMask signs an EIP-191 login; only the on-chain `AdminGuardianRecovery.guardian` EOA (or `WALLET_ADMIN_GUARDIAN` fallback) may approve/reject
- Approve enqueues a `wallet_recovery_jobs` initiate; the deployer still holds `guardianPrivateKey`
- OTP codes are SHA-256 hashed at rest; never returned in HTTP JSON

## Wallet EOA owners (Connect wallet)

- Simple wallets add a connected EOA via `addOwnerEoa` (EIP-712 `AddOwner`); the address is stored as a sentinel `qx`/`qy` owner and can sign UserOps with EIP-712 `UserOp(bytes32 userOpHash)`
- Super Wallets add `KEY_EOA` on the current identity via `addKeyEoa` (EIP-712 `AddKey`)
- Domain: name `Trustless Commerce Wallet`, version `1`, `chainId`, `verifyingContract` = wallet
- `WalletFactory.walletImplementation` is **immutable**. Existing clones keep the bytecode they were created with (P256-only / EIP-191 EOA). New EOA-owner / EIP-712 validation requires a **new** implementation and factory; update `WALLET_FACTORY_ADDRESS` after redeploy
- Deploy `WalletEip712` first and link it when compiling/deploying `Wallet` (`scripts/deploy-wallet.ts`)
