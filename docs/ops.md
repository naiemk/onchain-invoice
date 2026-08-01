# Ops / Docker

## Local smoke (before prod)

From a workspace that contains both `onchain-invoice` and `trustless-commerce`:

```bash
cd trustless-commerce
npm run docker:test
```

Checks (in-network via compose exec): HTTPS health, HTTP→HTTPS redirect, HSTS headers, create rate limit (429).

Compose publishes host ports **18080/18443** (avoids clashing with a local API on 8080). Nested Docker environments may not reach published ports from the host; the smoke script uses container networking.
## Production

- Compose: nginx (TLS) + api (internal only) + **SQLite volume** (single API replica)
- Mount real certs at `deploy/certs/` (`fullchain.pem`, `privkey.pem`)
- Never bake private keys into images
- Backup DB volume regularly (`sqlite3 .backup` or volume snapshot)

## CI

`trustless-commerce` workflow `.github/workflows/docker.yml` builds and pushes API + sweeper images on every `main` commit (pins sibling `onchain-invoice` via `.onchain-invoice-pin`).
