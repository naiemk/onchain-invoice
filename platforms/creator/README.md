# Creator platform connectors (Kajabi & Teachable)

External crypto checkout + fulfillment for course sellers, memberships, and digital products.

## Model

Creator platforms rarely allow custom payment gateways. The integration pattern is:

1. **Buy with crypto** button on sales page (hosted pay link or API-created invoice)
2. Buyer pays on Trustless Commerce hosted `/pay`
3. **Callback webhook** enrolls the buyer or grants access

```
Sales page → Create invoice → Hosted /pay → Callback → Enroll / grant access
```

## Shared connector

[`shared/fulfillment-server.js`](shared/fulfillment-server.js) — reusable Node server for both platforms:

| Route | Purpose |
|-------|---------|
| `POST /checkout` | Create invoice from `{ email, productId, price, title }` |
| `POST /webhooks/trustless-commerce` | Payment callback → fulfillment hook |
| `GET /health` | Liveness |

Platform-specific adapters call your fulfillment hook:

- **Kajabi:** Kajabi API offer grant / member tag (configure `KAJABI_*` env)
- **Teachable:** Teachable webhook / enrollment API (configure `TEACHABLE_*` env)

## Kajabi

See [`kajabi/README.md`](kajabi/README.md).

## Teachable

See [`teachable/README.md`](teachable/README.md).

Contract: [docs/platform-integration.md](../../docs/platform-integration.md)
