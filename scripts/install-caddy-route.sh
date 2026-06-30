#!/usr/bin/env bash
set -euo pipefail

ORIGIN="${RECORDING_SUMMARY_ORIGIN:-}"
CADDYFILE="${CADDYFILE:-/opt/drone_v2/backend/Caddyfile}"
CADDY_CONTAINER="${CADDY_CONTAINER:-drone-v2-prod-caddy-1}"
UPSTREAM="${RECORDING_SUMMARY_UPSTREAM:-recording_summary_app:8787}"

if [ -z "$ORIGIN" ]; then
  echo "RECORDING_SUMMARY_ORIGIN is empty; skip Caddy route"
  exit 0
fi

HOST="${ORIGIN#http://}"
HOST="${HOST#https://}"
HOST="${HOST%%/*}"

if [ -z "$HOST" ]; then
  echo "Invalid RECORDING_SUMMARY_ORIGIN: $ORIGIN" >&2
  exit 1
fi

test -f "$CADDYFILE"

tmp="$(mktemp)"
backup="$(mktemp)"
cp "$CADDYFILE" "$backup"
awk '
  /^# recording-summary:start$/ { skip = 1; next }
  /^# recording-summary:end$/ { skip = 0; next }
  skip != 1 { print }
' "$CADDYFILE" > "$tmp"

cat >> "$tmp" <<EOF

# recording-summary:start
$HOST {
	handle {
		reverse_proxy $UPSTREAM
	}
}
# recording-summary:end
EOF

cat "$tmp" > "$CADDYFILE"
rm -f "$tmp"

if ! docker exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile; then
  cat "$backup" > "$CADDYFILE"
  rm -f "$backup"
  echo "Caddy validation failed; restored previous Caddyfile" >&2
  exit 1
fi

rm -f "$backup"
docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile
