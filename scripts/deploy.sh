#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/recording-summary}"
DATA_DIR="${DATA_DIR:-/var/lib/recording-summary}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.cloud.yml}"

cd "$APP_DIR"
if [ "${SKIP_GIT_SYNC:-0}" != "1" ]; then
  git fetch --prune
  git reset --hard origin/main
fi
mkdir -p "$DATA_DIR"
test -f .env
docker compose --env-file .env -f "$COMPOSE_FILE" up -d --build

for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:18787/api/health >/dev/null; then
    exit 0
  fi
  sleep 2
done

echo "recording-summary did not become healthy" >&2
exit 1
