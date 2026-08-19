# packageconfig.yaml schema

Product-owned file. Infra reads **only** the fields below.

## Top level

```yaml
name: my-product          # slug for cron markers / logs
version: 1

rawBase: https://raw.githubusercontent.com/org/repo/main/deploy/templates
packagerRaw: https://raw.githubusercontent.com/org/repo/main/infra

network:
  edge: my-product-edge   # shared Docker network for gateway + APIs

images:
  backend: ghcr.io/org/my-api:main
  ui: ghcr.io/org/my-ui:main
  worker: ghcr.io/org/my-worker:main
  nginx: ghcr.io/org/my-nginx:main   # optional; default nginx:alpine + mounted conf

autoUpdate:
  lockFile: /var/lock/infra-auto-update.lock  # optional
```

## profiles

Each install directory maps to one profile key (`api`, `nodes`, `gateway`, …).

```yaml
profiles:
  api:
    role: backend           # backend | workers | gateway
    templates:
      config: app.yaml      # fetched from rawBase; never overwritten if exists
      envExample: .env.api.example
    startScript: start-api.sh    # copied from rawBase or generated
    updateScript: update-api.sh
    autoUpdate:
      flag: API_AUTO_UPDATE
      intervalEnv: API_AUTO_UPDATE_INTERVAL_MIN
      offset: 0               # cron minute offset (api :00, nodes :10, gateway :20)
      stopTimeoutEnv: API_STOP_TIMEOUT
    extras: []                # optional scripts from rawBase (e.g. register-node.sh)

  nodes:
    role: workers
    templates:
      config: workers.yaml
      envExample: .env.nodes.example
      compose: docker-compose.workers.yml
    workers:
      services:
        - name: worker-a
          containerName: my-worker-a
          roleEnv: WORKER_ROLE=a
          activityLog: /data/logs/a.jsonl
        - name: worker-b
          profile: optional   # compose profile name
    autoUpdate: { flag: NODES_AUTO_UPDATE, offset: 10, ... }

  gateway:
    role: gateway
    mode: standalone          # standalone | bundled
    templates:
      envExample: .env.gateway.example
      nginxInclude: gateway/extra.conf   # optional product snippet
    sites:
      - host: app.example.com
        aliases: [www.app.example.com]
        backend: app-api
        backendPort: 8080
        ui: app-ui
        uiPort: 80
        tlsCertDir: /etc/letsencrypt/live/app.example.com
    autoUpdate:
      flags: [UI_AUTO_UPDATE, GATEWAY_AUTO_UPDATE]
      offset: 20
```

## Infra ignores

- Keys inside `config` YAML templates
- Secret names inside `.env` (opaque strings)
- Application health-check response bodies
