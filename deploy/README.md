# Deploy

## Local test

From this repo root:

```bash
npm run docker:test
```

Checks HTTPS health, HTTP→HTTPS redirect, HSTS, and create rate limit (via compose networking). Host ports are **18080/18443**.

## Images (GHCR)

Built on every push to `main` by `.github/workflows/docker.yml`:

- `ghcr.io/<owner>/trustless-commerce-api`
- `ghcr.io/<owner>/trustless-commerce-sweeper`

## Prod checklist

1. Mount TLS certs into nginx (`deploy/certs/`)
2. Set `ADMIN_API_KEY`, RPC, sweeper address via env / YAML (`commerce/config/`)
3. Persist SQLite volume; single API replica only
4. Register sweeper wallets via `POST /api/admin/sweepers`
5. Run sweeper containers on separate machines per chain as needed
