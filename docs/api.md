# HTTP API

## Public

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/health` | Liveness |
| GET | `/api/ready` | DB ready |
| POST | `/api/invoices` | Create (rate limited ~1/s/IP) |
| GET | `/api/invoices/:id` | Status + events |
| GET | `/api/invoices?to=0x…` | Merchant list |

## Admin (`x-api-key: ADMIN_API_KEY`)

| Method | Path |
|--------|------|
| GET | `/api/admin/stats` |
| POST | `/api/admin/sweepers` |

## Sweeper (wallet-signed)

| Method | Path |
|--------|------|
| GET | `/api/sweeper/me` |
| GET | `/api/sweeper/invoices` |
| POST | `/api/sweeper/heartbeat` |
| POST | `/api/sweeper/claim` |
| POST | `/api/sweeper/track` |

Headers: `x-sweeper-address`, `x-sweeper-timestamp`, `x-sweeper-nonce`, `x-sweeper-body-hash`, `x-sweeper-signature`.

Track/claim use optimistic `expectedVersion`; conflicts return **409**.

Rate limit create returns **429** with `Retry-After`. Public create is unauthenticated (spam risk accepted at launch).

## Platform integrations

Ecommerce and creator platform adapters (WooCommerce, Shopify, Kajabi, Teachable) build on the same contract:

- [Platform integration contract](platform-integration.md)
- SDKs and plugins: [`platforms/`](../platforms/)
