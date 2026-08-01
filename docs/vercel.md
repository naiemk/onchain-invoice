# Vercel (frontend)

- Framework: Vite
- Root Directory: leave repo root (or set to `.`) and Build Command: `npm run ui:build`
- Output Directory: `dist-ui`
- Install: `npm ci`
- Env (production): `VITE_API_BASE_URL=https://your-api.example.com` (or configure rewrites to the API)
- SPA rewrites + security headers: [`ui/vercel.json`](ui/vercel.json)

Preview deploys should set the same `VITE_API_BASE_URL` or allow CORS from `*.vercel.app` in server YAML.
