# HTTP API

## Public

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/health` | Liveness (no rate limit) |
| GET | `/api/ready` | DB ready (no rate limit) |
| POST | `/api/invoices` | Create (rate limited — `create` bucket) |
| GET | `/api/invoices/:id` | Status + events |
| GET | `/api/invoices?to=0x…` | Merchant list (signed) |
| GET | `/api/public/onramp` | Onramper capability probe |
| GET | `/api/public/onramp-quote` | Fiat↔crypto quote ([Quote API](quote.md)) |
| GET | `/api/public/onramp-methods` | Payment methods for a quote |
| POST | `/api/invoices/:id/onramp-session` | Start card/bank checkout widget |

Invoice type field shapes and worked examples: [Invoice types](invoice-types.md).

## Admin (`x-api-key: ADMIN_API_KEY`)

| Method | Path |
|--------|------|
| GET | `/api/admin/stats` |
| POST | `/api/admin/sweepers` |
| POST | `/api/admin/bundlers` |

Admin and `/api/internal/*` routes are **not** rate-limited (API-key gated).

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

## Bundler (wallet-signed)

| Method | Path |
|--------|------|
| GET | `/api/bundler/userops` |
| POST | `/api/bundler/claim` |
| POST | `/api/bundler/track` |

Same header pattern as sweeper (`x-bundler-*`). Register via `POST /api/admin/bundlers` then `./register-onchain-invoice-bundler.sh`.

Wallet UserOps: `POST /api/wallet/userops` (public submit). Rejected/failed hashes may be **requeued** with a fresh signature; pending/included hashes return **409** `duplicate_user_op_hash`.

## Rate limiting

Central table-driven limiter (IP + bucket). New public routes are limited by default.

| Bucket | Default | Env | Used for |
|--------|---------|-----|----------|
| `create` | 1/s | `RATE_LIMIT_CREATE_PER_SECOND` | `POST /api/invoices` (+ aliases, faucet capped) |
| `public` | 20/s | `RATE_LIMIT_PUBLIC_PER_SECOND` | Public GETs, wallet APIs, onramp config |
| `quote` | 2/s, burst 20 | `RATE_LIMIT_QUOTE_PER_SECOND`, `RATE_LIMIT_QUOTE_BURST` | `/api/public/onramp-quote`, `/api/public/onramp-methods` |
| `sweeper` | 50/s | `RATE_LIMIT_SWEEPER_PER_SECOND` | Sweeper + bundler signed APIs |

**Exempt:** `/api/health`, `/api/ready`, `/api/admin/*`, `/api/internal/*`, wallet deployer routes.

Exceeding a limit returns **429** `{ "error": "Rate limit exceeded" }` with:

- `Retry-After` (seconds)
- `RateLimit-Remaining`
- `RateLimit-Reset`

Agents should back off and retry after `Retry-After`. Public create and quote are unauthenticated (spam risk accepted at launch; captcha optional via Turnstile).

## Platform integrations

Ecommerce and creator platform adapters (WooCommerce, Shopify, Kajabi, Teachable) build on the same contract:

- [Platform integration contract](platform-integration.md)
- SDKs and plugins: [`platforms/`](../platforms/)
