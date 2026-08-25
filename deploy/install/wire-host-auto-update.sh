#!/usr/bin/env bash
# One-shot: enable GHCR auto-update for mainnet (+ refresh testnet) on a VPS
# that keeps installs under /root/tc and only exposes docker to cursor-agent.
#
# Run on the VPS as cursor-agent (docker group). Example:
#   bash deploy/install/wire-host-auto-update.sh
#
# Requires: docker, and ability to bind-mount /root/tc + /etc/cron.d.
set -euo pipefail

ROOT_TC="${ROOT_TC:-/root/tc}"
SCRIPT_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Syncing updater scripts into $ROOT_TC …"
docker run --rm \
  -v "${ROOT_TC}:/tc" \
  -v "${SCRIPT_SRC}:/src:ro" \
  alpine sh -c '
    set -e
    for pair in \
      "api-mainnet:lib-env.sh install-auto-update.sh update-onchain-invoice-api.sh start-onchain-invoice-api.sh" \
      "api:lib-env.sh install-auto-update.sh update-onchain-invoice-api.sh start-onchain-invoice-api.sh" \
      "sweeper-mainnet:lib-env.sh install-auto-update.sh update-onchain-invoice-nodes.sh start-onchain-invoice-nodes.sh docker-compose.sweepers-mainnet.yml" \
      "sweeper:lib-env.sh install-auto-update.sh update-onchain-invoice-nodes.sh start-onchain-invoice-nodes.sh docker-compose.sweepers.yml register-onchain-invoice-bundler.sh onchain-invoice-bundler.yaml onchain-invoice-wallet-deployer.yaml" \
      "gateway:lib-env.sh install-auto-update.sh update-onchain-invoice-gateway.sh start-onchain-invoice-gateway.sh"
    do
      dir="${pair%%:*}"
      files="${pair#*:}"
      [ -d "/tc/$dir" ] || continue
      for f in $files; do
        [ -f "/src/$f" ] || continue
        cp "/src/$f" "/tc/$dir/$f"
        chmod +x "/tc/$dir/$f" 2>/dev/null || true
      done
    done

    # Mainnet API
    if [ -f /tc/api-mainnet/.env ]; then
      grep -q "^API_AUTO_UPDATE=" /tc/api-mainnet/.env \
        && sed -i "s|^API_AUTO_UPDATE=.*|API_AUTO_UPDATE=1|" /tc/api-mainnet/.env \
        || echo API_AUTO_UPDATE=1 >> /tc/api-mainnet/.env
      grep -q "^API_AUTO_UPDATE_INTERVAL_MIN=" /tc/api-mainnet/.env \
        && sed -i "s|^API_AUTO_UPDATE_INTERVAL_MIN=.*|API_AUTO_UPDATE_INTERVAL_MIN=30|" /tc/api-mainnet/.env \
        || echo API_AUTO_UPDATE_INTERVAL_MIN=30 >> /tc/api-mainnet/.env
      grep -q "^API_MEMORY_LIMIT=" /tc/api-mainnet/.env \
        || echo API_MEMORY_LIMIT=384m >> /tc/api-mainnet/.env
    fi

    # Mainnet sweepers — must track GHCR :main (not a local-only tag)
    if [ -f /tc/sweeper-mainnet/.env ]; then
      grep -q "^NODES_AUTO_UPDATE=" /tc/sweeper-mainnet/.env \
        && sed -i "s|^NODES_AUTO_UPDATE=.*|NODES_AUTO_UPDATE=1|" /tc/sweeper-mainnet/.env \
        || echo NODES_AUTO_UPDATE=1 >> /tc/sweeper-mainnet/.env
      grep -q "^NODES_AUTO_UPDATE_INTERVAL_MIN=" /tc/sweeper-mainnet/.env \
        && sed -i "s|^NODES_AUTO_UPDATE_INTERVAL_MIN=.*|NODES_AUTO_UPDATE_INTERVAL_MIN=30|" /tc/sweeper-mainnet/.env \
        || echo NODES_AUTO_UPDATE_INTERVAL_MIN=30 >> /tc/sweeper-mainnet/.env
      grep -q "^SWEEPER_MEMORY_LIMIT=" /tc/sweeper-mainnet/.env \
        || echo SWEEPER_MEMORY_LIMIT=192m >> /tc/sweeper-mainnet/.env
      grep -q "^SWEEPER_SOLANA_ENABLED=" /tc/sweeper-mainnet/.env \
        || echo SWEEPER_SOLANA_ENABLED=0 >> /tc/sweeper-mainnet/.env
      grep -q "^SWEEPER_IMAGE=" /tc/sweeper-mainnet/.env \
        && sed -i "s|^SWEEPER_IMAGE=.*|SWEEPER_IMAGE=ghcr.io/naiemk/trustless-commerce-sweeper:main|" /tc/sweeper-mainnet/.env \
        || echo SWEEPER_IMAGE=ghcr.io/naiemk/trustless-commerce-sweeper:main >> /tc/sweeper-mainnet/.env
      grep -q "^COMPOSE_FILE=" /tc/sweeper-mainnet/.env \
        && sed -i "s|^COMPOSE_FILE=.*|COMPOSE_FILE=docker-compose.sweepers-mainnet.yml|" /tc/sweeper-mainnet/.env \
        || echo COMPOSE_FILE=docker-compose.sweepers-mainnet.yml >> /tc/sweeper-mainnet/.env
      if [ -f /tc/sweeper-mainnet/docker-compose.sweepers-mainnet.yml ]; then
        sed -i "s|\${SWEEPER_IMAGE:-tc-sweeper-mainnet:local}|\${SWEEPER_IMAGE:-ghcr.io/naiemk/trustless-commerce-sweeper:main}|g" \
          /tc/sweeper-mainnet/docker-compose.sweepers-mainnet.yml
      fi
    fi

    # Gateway UI + nginx
    if [ -f /tc/gateway/.env ]; then
      for key in UI_MAINNET_AUTO_UPDATE UI_TESTNET_AUTO_UPDATE GATEWAY_AUTO_UPDATE; do
        grep -q "^${key}=" /tc/gateway/.env \
          && sed -i "s|^${key}=.*|${key}=1|" /tc/gateway/.env \
          || echo "${key}=1" >> /tc/gateway/.env
      done
      grep -q "^GATEWAY_AUTO_UPDATE_INTERVAL_MIN=" /tc/gateway/.env \
        && sed -i "s|^GATEWAY_AUTO_UPDATE_INTERVAL_MIN=.*|GATEWAY_AUTO_UPDATE_INTERVAL_MIN=20|" /tc/gateway/.env \
        || echo GATEWAY_AUTO_UPDATE_INTERVAL_MIN=20 >> /tc/gateway/.env
      grep -q "^UI_MEMORY_LIMIT=" /tc/gateway/.env || echo UI_MEMORY_LIMIT=64m >> /tc/gateway/.env
      grep -q "^GATEWAY_MEMORY_LIMIT=" /tc/gateway/.env || echo GATEWAY_MEMORY_LIMIT=64m >> /tc/gateway/.env
    fi
  '

echo "Installing /etc/cron.d drop-ins …"
for dir in api-mainnet sweeper-mainnet gateway api sweeper; do
  if ! docker run --rm -v "${ROOT_TC}:/root/tc" alpine test -x "/root/tc/${dir}/install-auto-update.sh"; then
    echo "skip missing $dir"
    continue
  fi
  echo "→ $dir"
  docker run --rm \
    -v "${ROOT_TC}:/root/tc" \
    -v /etc/cron.d:/etc/cron.d \
    -w "/root/tc/${dir}" \
    docker:27-cli \
    sh -c 'apk add --no-cache bash >/dev/null && ./install-auto-update.sh'
done

echo
echo "Installed cron.d entries:"
docker run --rm -v /etc/cron.d:/etc/cron.d alpine sh -c 'ls -la /etc/cron.d/tc-* 2>/dev/null; echo; cat /etc/cron.d/tc-* 2>/dev/null'
echo
echo "Done. After the next GHCR :main publish, cron will pull and recreate within the configured interval."
