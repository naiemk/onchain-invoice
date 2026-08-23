---
name: trustless-commerce-invoice
description: >-
  Create Trustless Commerce crypto invoices and check payment status. Use when building
  or verifying USDC/USDT pay links, invoiceAddress, awaiting_payment,
  POST /api/invoices create invoice API, GET /api/invoices/:id polling, sweep status,
  Trustless Commerce checkout, Sepolia, Nile, or crypto invoice integration for shops and agents.
---

# Trustless Commerce — create & check invoices

## When to use

- Create a payment link or embed button for a shop order
- Call the one-shot create invoice API
- Check whether an invoice is `created`, `awaiting_payment`, `paid`, `paid_partial`, or `swept`

No merchant wallet connection is required for create or status check.

## Canonical agent path (one step)

### Sepolia USDC

```http
POST /api/invoices
Content-Type: application/json

{
  "price": "10.00",
  "to": ["0x…"],
  "chains": ["11155111"],
  "tokens": ["USDC"],
  "clientInvoiceId": "order-1",
  "chainId": "11155111",
  "token": "USDC",
  "selectedTo": "0x…",
  "title": "Order",
  "allowPartial": false
}
```

### Nile USDT

```http
POST /api/invoices
Content-Type: application/json

{
  "price": "10.00",
  "to": ["T…"],
  "chains": ["nile"],
  "tokens": ["USDT"],
  "clientInvoiceId": "order-1",
  "chainId": "nile",
  "token": "USDT",
  "selectedTo": "T…",
  "title": "Order",
  "allowPartial": false
}
```

Multi-chain links may include both an EVM `0x…` and Tron `T…` in `to`, with `chains: ["11155111","nile"]` and `tokens: ["USDC","USDT"]`. Pick `chainId` / `token` / `selectedTo` consistent with one kind when creating.

**Do not** send `invoiceSeed` / `invoice_seed` — the API assigns a random seed and derives `invoice.id`. Client-supplied seeds are rejected (`400`).

Response includes `invoice` (with `invoiceAddress`, status `awaiting_payment`), resume `payLink` (`/pay?id=…`), and `checkoutLink` (shareable template without seed).

Duplicate invoice ids are rejected with `409`. Use `Idempotency-Key` for safe retries of the same create.

**Do not** use deprecated `POST /api/sessions` + `POST /api/invoices/activate`.

### Solana Devnet (USDC or USDT)

```http
POST /api/invoices
Content-Type: application/json

{
  "price": "10.00",
  "to": ["So111…"],
  "chains": ["devnet"],
  "tokens": ["USDC", "USDT"],
  "clientInvoiceId": "order-1",
  "chainId": "devnet",
  "token": "USDC",
  "selectedTo": "So111…",
  "title": "Order",
  "allowPartial": false
}
```

`invoiceAddress` is the invoice PDA's ATA for the selected mint (mint is bound into PDA seeds). Settlement is destination-bound on-chain (sweeper cannot redirect). Mainnet (`mainnet-beta`) uses the same API once enabled in config.

Stablecoins only for now (`USDC`/`USDT` on Solana, `USDC` on EVM, `USDT` on Nile). Token–chain pairs are enforced. Rate limit: ~1 create/s per IP (429 if exceeded).

### Optional `paymentMode` (card/bank)

When the operator enables Onramper (`ONRAMPER_ENABLED` + keys), create may set:

- `paymentMode`: `"crypto"` (default) | `"crypto_or_fiat"` | `"fiat"`
- Fiat-only requires **exactly one** chain and token on a supported mainnet rail (Base USDC, Tron USDT, BNB USDC/USDT).
- Paid still means the invoice address was funded on-chain (existing poll / sweeper). Card checkout is only a funding source via `POST /api/invoices/:id/onramp-session` with `{ "fiat": "EUR" }`.

## Pay link (browser)

```text
/pay?price=10&to=0x…&chains=11155111&tokens=USDC&title=Order&allow_partial=0
/pay?price=10&to=T…&chains=nile&tokens=USDT&title=Order&allow_partial=0
```

Shareable checkout links never include `invoice_seed`. The API creates the seed when the payer continues (or when you call `POST /api/invoices`). After create, resume with `/pay?id=<invoiceId>`.

Deterministic `invoiceId` = `keccak256(abi.encode(bytes32 invoiceSeed, string[] toAddresses))`.
Uniqueness comes from a server-generated random `invoiceSeed`; `toAddresses` bind payout destinations.
`clientInvoiceId`, price, title, etc. are metadata only (not part of the hash).
`chains` / `tokens` are not part of the hash.

Helpers: `ui/src/shared/invoice.ts`. Manual UI: `/create`. Docs: https://naiemk.github.io/onchain-invoice/

## Check status

```http
GET /api/invoices/{invoiceId}
```

Poll every few seconds until `paid`, `paid_partial`, or `swept`.
