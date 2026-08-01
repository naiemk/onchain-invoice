# Sweepers

One worker role: **sweeper node** (detect → claim → track paid → sweep → track swept).

- Register wallet: `POST /api/admin/sweepers` with admin key
- Sign every request with that wallet
- **Claim** before broadcasting on-chain (`claimed_by` / `claimed_until` lease)
- **Optimistic version** on every write; retry on 409

Config: YAML `config/sweeper.example.yaml` in trustless-commerce. Run one container per chain host if needed (same image).

Docker image: `ghcr.io/<org>/trustless-commerce-sweeper` (built on every `main` push).
