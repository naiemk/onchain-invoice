---
name: trustless-commerce-wallet
description: >-
  Integrate Trustless Commerce HMAC wallet client API for passkey smart wallets on a
  partner domain. Use when building POST /api/client/wallets, list wallets by email,
  WebAuthn on client rpId, send UserOp prepare/submit, initiate/cancel recovery,
  x-client-signature HMAC, wallet-clients admin, or embedded crypto wallets (not hosted /wallet).
---

# Trustless Commerce — HMAC wallet client API

## When to use

- Embed passkey wallets on a **partner** site (WebAuthn RP ID = their domain)
- Server-to-server create / list / send / recover with HMAC
- Admin-issued `wallet-clients` with `rpId` + secret

## When **not** to use

- Hosted product UI `/wallet` or public `/api/wallet/*` (different RP ID = our hostname)
- Crypto **invoices** / pay links → use `.cursor/skills/trustless-commerce-invoice/SKILL.md` (`POST /api/invoices`)

## Rate limits (read first)

| Bucket | Default | Routes |
|--------|---------|--------|
| `wallet_client` | ~50/s/IP | `/api/client/wallets*` |

**429** includes `Retry-After`. Back off.

## Hard rules

- **Never** put `hmacSecret` in browser JS
- WebAuthn `rp.id` / `rpId` = **client** domain from admin `rpId`, not Trustless Commerce hostname
- HMAC `Path:` is **pathname only** (no query string)
- Identity is `(clientId, email)` — not global across partners
- Recovery requires `identityVerified: true` (partner is IdP; we do not send email)
- Do not send `invoiceSeed` (invoice API only)

Full field tables: `docs/wallet-client-api.md`.

## HMAC signing

Headers: `x-client-id`, `x-client-timestamp` (ms, ±5 min), `x-client-nonce`, `x-client-body-hash` (SHA-256 hex of raw body; empty string for GET), `x-client-signature` (HMAC-SHA256 hex).

Canonical message:

```text
Trustless Commerce client request
Method: POST
Path: /api/client/wallets
Body-SHA256: <hex>
Timestamp: <ms>
Nonce: <uuid>
```

## Admin (issue client)

```http
POST /api/admin/wallet-clients
x-api-key: ADMIN_API_KEY
Content-Type: application/json

{ "label": "Acme", "rpId": "example.com", "origins": ["https://example.com"] }
```

→ `{ client, hmacSecret }` (secret once). Rotate: `POST /api/admin/wallet-clients/:id/rotate`. Disable: `PATCH … { "enabled": false }`.

## Canonical flows

### 1. Challenge → create

```http
POST /api/client/wallets/challenges
{ "purpose": "create", "email": "user@example.com" }
```

→ `{ challengeId, challenge }` (base64url). Browser: `credentials.create` then `credentials.get` with that challenge on **your** `rpId`. Extract `ownerQx`/`ownerQy`/`credentialId`.

```http
POST /api/client/wallets
{
  "email": "user@example.com",
  "challengeId": "…",
  "ownerQx": "0x…",
  "ownerQy": "0x…",
  "credentialId": "…",
  "assertion": {
    "authenticatorData": "…",
    "clientDataJSON": "…",
    "signature": "…"
  },
  "label": "Phone"
}
```

### 2. List by email

```http
GET /api/client/wallets?email=user@example.com
```

Sign path `/api/client/wallets` (no query). Response `wallets[].devices[]` has keys for `allowCredentials`.

### 3. Send (user-signed)

```http
POST /api/client/wallets/0xWallet…/send/prepare
{ "chainId": "11155111", "token": "USDC", "to": "0x…", "amount": "1000000" }
```

→ `{ userOp, userOpHash, bundlerFeeUsdc }`. User signs **`userOpHash`** via WebAuthn (no server challenge). Then:

```http
POST /api/client/wallets/0xWallet…/send
{ "userOp": { "…": "…", "signature": "0x…" }, "userOpHash": "0x…", "credentialId": "…" }
```

### 4. Initiate recovery (after partner email/IdP verify)

```http
POST /api/client/wallets/challenges
{ "purpose": "recover", "email": "user@example.com" }
```

New device passkey + assertion, then:

```http
POST /api/client/wallets/0xWallet…/recovery
{
  "email": "user@example.com",
  "identityVerified": true,
  "challengeId": "…",
  "ownerQx": "0x…",
  "ownerQy": "0x…",
  "credentialId": "…",
  "assertion": { }
}
```

### 5. Cancel recovery

```http
POST /api/client/wallets/challenges
{ "purpose": "cancel" }
```

Existing owner device:

```http
POST /api/client/wallets/0xWallet…/recovery/cancel
{
  "challengeId": "…",
  "credentialId": "…",
  "assertion": { }
}
```

Status: `GET /api/client/wallets/0xWallet…/recovery`.

## Operator notes

- Wallet-deployer runs guardian recovery (`initiate` / `cancel` / auto-`execute` after timelock)
- Configure `recoveryAddress` + optional `guardianPrivateKey` on deployer YAML (defaults to deployer key)
