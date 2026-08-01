---
name: trustless-commerce-invoice
description: >-
  Create Trustless Commerce crypto invoices and check payment status. Use when building
  or verifying USDC pay links, client_invoice_id fields, invoiceAddress, awaiting_payment,
  POST /api/invoices create invoice API, GET /api/invoices/:id polling, sweep status,
  Trustless Commerce checkout, or crypto invoice integration for shops and agents.
---

# Trustless Commerce — create & check invoices

## When to use

- Create a payment link or embed button for a shop order
- Call the one-shot create invoice API
- Check whether an invoice is `created`, `awaiting_payment`, `paid`, `paid_partial`, or `swept`

No merchant wallet connection is required for create or status check.

## Canonical agent path (one step)

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

Response includes `invoice` (with `invoiceAddress`, status `awaiting_payment`) and `payLink`.

Idempotent: same deterministic invoice id returns the same invoice (`200` if already created).

**Do not** use deprecated `POST /api/sessions` + `POST /api/invoices/activate`.

Stablecoins only for now (e.g. `USDC`). Rate limit: ~1 create/s per IP (429 if exceeded).

## Pay link (browser)

```text
/pay?price=10&to=0x…&chains=11155111&tokens=USDC&client_invoice_id=order-1&title=Order&allow_partial=0
```

Payer can open the link and create on Continue if the merchant did not call the API first.

Deterministic `invoiceId` = `keccak256` of ABI-encoded:
`priceUsd`, `toAddresses`, `clientInvoiceId`, `callbackUrl`, `title`, `description`, `allowPartial`
(`chains` / `tokens` are not part of the hash.)

Helpers: `ui/src/shared/invoice.ts`. Manual UI: `/create`. Docs: https://naiemk.github.io/onchain-invoice/

## Check status

```http
GET /api/invoices/{invoiceId}
```

Poll every few seconds until `paid`, `paid_partial`, or `swept`.

## Agent checklist

1. Collect required fields; default chain `11155111` and token `USDC` only if the merchant agrees.
2. `POST /api/invoices` with `chainId`, `token`, `selectedTo`.
3. Return pay URL, `invoiceAddress`, and status API URL.
4. To verify payment: `GET /api/invoices/{invoiceId}` and report `status`, `invoiceAddress`, `amountPaid`, `sweepTx`.
