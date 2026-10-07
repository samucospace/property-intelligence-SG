#!/usr/bin/env bash
set -euo pipefail
umask 077
python3 - <<'PY'
from pathlib import Path
hashed = Path('/opt/homeintel/config/staging-password.hash').read_text().strip()
if not hashed.startswith('$2') or '\n' in hashed:
    raise SystemExit('Password hash validation failed')
Path('/opt/homeintel/config/staging-proxy.env').write_text(
    'STAGING_DOMAIN=staging.homeintel.sg\n'
    'STAGING_BASIC_AUTH_USER=sam\n'
    "STAGING_BASIC_AUTH_HASH='" + hashed + "'\n")
PY
chmod 600 /opt/homeintel/config/staging-proxy.env
cd /opt/homeintel/release
docker compose -p homeintel-private -f compose.private-local.yml -f compose.staging-proxy.yml run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose -p homeintel-private -f compose.private-local.yml -f compose.staging-proxy.yml up -d --no-deps caddy
