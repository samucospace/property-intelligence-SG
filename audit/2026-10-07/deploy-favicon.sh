#!/usr/bin/env bash
set -euo pipefail
cd /opt/homeintel/release
docker load -i favicon-image.tar
test "$(docker image inspect property-intelligence-sg:favicon-20261007 --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = c17bce4e4cb34cb1d2c8ff5f68bea18753cbc0d3
cp -p compose.private-local.yml compose.private-local.before-favicon.yml
sed -i 's/property-intelligence-sg:filter-repairs-20261007/property-intelligence-sg:favicon-20261007/g' compose.private-local.yml
docker compose -p homeintel-private -f compose.private-local.yml -f compose.staging-proxy.yml --profile maintenance up -d app scheduler
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/api/health/ready; then exit 0; fi
  sleep 2
done
cp -p compose.private-local.before-favicon.yml compose.private-local.yml
docker compose -p homeintel-private -f compose.private-local.yml -f compose.staging-proxy.yml --profile maintenance up -d app scheduler
exit 1
