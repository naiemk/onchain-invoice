# Create an invoice

## Canonical path (agents & merchants)

One HTTP call creates the invoice and payment address:

```http
POST /api/invoices
```

Include `chainId`, `token` (e.g. `USDC`), and `selectedTo`. Response: `invoiceAddress`, status `awaiting_payment`.

Idempotent by deterministic invoice id. Optional header: `Idempotency-Key`.

## Browser pay link

Customers can open `/pay?…` without a prior API call; Continue creates the invoice.

## Deprecated

`POST /api/sessions` and `POST /api/invoices/activate` remain as thin aliases — do not use for new integrations.
