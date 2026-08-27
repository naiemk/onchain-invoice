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

### Checkout chrome (`header`)

Optional query param on shareable `/pay` links (UI only — not sent to `POST /api/invoices`):

| Value | Effect |
|-------|--------|
| `full` (default top-level) | Full Trustless Commerce header and footer |
| `minimal` | Brand + locale/theme; thin footer |
| `none` | No chrome — for iframes |

When `/pay` is loaded inside an iframe, chrome defaults to `none` even if `header` is omitted. Set `header=full` or `header=minimal` to force chrome inside an embed.

Cross-origin embedding is allowed for `/pay` only (`Content-Security-Policy: frame-ancestors *`). Other UI routes stay non-embeddable.

```html
<iframe
  src="https://your.host/pay?price=10&to=0x…&chains=11155111&tokens=USDC&header=none"
  title="Pay with crypto"
  style="width:100%;min-height:720px;border:0"
  allow="payment *"
></iframe>
```

The create invoice preview builds this iframe snippet automatically (always with `header=none`).

## Deprecated

`POST /api/sessions` and `POST /api/invoices/activate` remain as thin aliases — do not use for new integrations.
