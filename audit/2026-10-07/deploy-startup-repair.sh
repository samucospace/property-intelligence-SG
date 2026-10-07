#!/usr/bin/env bash
set -euo pipefail
cd /opt/homeintel/release
docker load -i startup-repair-image.tar
test "$(docker image inspect property-intelligence-sg:startup-repair-20261007 --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = 7f9200c91a52f44fc19f7e33407326e9ba10a03c
cp -p compose.private-local.yml compose.private-local.before-startup-repair.yml
sed -i 's/property-intelligence-sg:favicon-20261007/property-intelligence-sg:startup-repair-20261007/g' compose.private-local.yml
docker compose -p homeintel-private -f compose.private-local.yml -f compose.staging-proxy.yml --profile maintenance up -d app scheduler
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/api/health/ready; then exit 0; fi
  sleep 2
done
cp -p compose.private-local.before-startup-repair.yml compose.private-local.yml
docker compose -p homeintel-private -f compose.private-local.yml -f compose.staging-proxy.yml --profile maintenance up -d app scheduler
exit 1
