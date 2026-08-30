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
- Mutating routes require Turnstile when `TURNSTILE_SECRET` is set; UI loads `TURNSTILE_SITE_KEY` from wallet-config
- Passkey assertions use the **hosted** WebAuthn `rpId` (API/public hostname), not a partner domain
- Guardian dashboard `/guardian` (not in nav): MetaMask signs an EIP-191 login; only the on-chain `AdminGuardianRecovery.guardian` EOA (or `WALLET_ADMIN_GUARDIAN` fallback) may approve/reject
- Approve enqueues a `wallet_recovery_jobs` initiate; the deployer still holds `guardianPrivateKey`
- OTP codes are SHA-256 hashed at rest; never returned in HTTP JSON
