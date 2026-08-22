# Infra packager

Product-agnostic VPS deployment packager: wget installer, Docker Compose layouts, digest-gated auto-update, TLS/nginx helpers, and CI skill templates.

**Infra does not read application config or secrets** — only `packageconfig.yaml` packager fields (image names, ports, volume paths, site hostnames).

## Quick start (product repo)

1. Add [`deploy/packageconfig.yaml`](../deploy/packageconfig.yaml) (Trustless Commerce example).
2. Put opaque templates under `deploy/templates/` (`.env.*.example`, app YAML, optional nginx snippets).
3. Thin wrapper:

```bash
wget -qO- https://raw.githubusercontent.com/you/your-repo/main/deploy/install.sh | bash
```

Or per-component:

```bash
wget -qO- "$PACKAGER_RAW/install.sh" | env INFRA_PROFILE=api PACKAGECONFIG_URL=... bash
```

## Layout

| Path | Purpose |
|------|---------|
| `install.sh` | Single entrypoint (TTY picker or `INFRA_PROFILE` / `--profile`) |
| `start.sh` / `update.sh` | Generic lifecycle in install dir |
| `install-auto-update.sh` | Cron from profile flags |
| `lib/` | fetch, env, update, cron, tls, prompt |
| `lib/generate.py` | Compose + nginx from packageconfig |
| `templates/` | Generic compose/nginx skeletons |
| `schema/packageconfig.md` | Schema reference |
| `skills/` | Cursor skills (packager, gateway, CI) |
| `github/workflows/` | Reusable GHCR build workflow |

## Profiles

Defined in product `packageconfig.yaml` → `profiles`:

- **api** — backend web service (SQLite/data dir, config mount)
- **nodes** — worker runners (compose, logs volume)
- **gateway** — HTTPS edge (UI containers + nginx on shared network)

Later products add profiles or reuse these three.

## Environment

| Variable | Meaning |
|----------|---------|
| `PACKAGER_RAW` | Base URL for this `infra/` tree |
| `PACKAGECONFIG_URL` | Full URL to product `packageconfig.yaml` |
| `INFRA_PROFILE` | Non-interactive profile (`api`, `nodes`, `gateway`) |
| `INSTALL_DIR` | Target directory (default `.`) |
| `ONCHAIN_INVOICE_RAW` | Legacy alias for product templates base |

## Multi-project gateway

Install gateway once per host on `trustless-commerce-edge` (or your `network.edge`). Each product API/UI joins the same Docker network with distinct container names. See [`skills/system-gateway/SKILL.md`](skills/system-gateway/SKILL.md).
