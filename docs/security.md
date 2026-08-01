# Security

- Sweepers never open the product DB; all updates go through the signed API
- Admin routes require `ADMIN_API_KEY`
- Admin UI is not in the public nav; still requires a valid key
- nginx + app rate limits (default 1 invoice create/s per IP)
- CORS allowlist via server YAML / `CORS_ORIGINS`
- Claim leases prevent double-sweep races between workers
- Follow-up: merchant API keys / captcha on create; Redis rate limits for multi-replica
