#!/usr/bin/env bash
set -euo pipefail
cd /opt/homeintel/release
docker load -i map-ux-image.tar
test "$(docker image inspect property-intelligence-sg:map-ux-20261007 --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = 58a031ebc552f13f68ba72240eb58540674bceee
cp -p compose.private-local.yml compose.private-local.before-map-ux.yml
sed -i 's/property-intelligence-sg:startup-repair-20261007/property-intelligence-sg:map-ux-20261007/g' compose.private-local.yml
docker compose -p homeintel-private -f compose.private-local.yml -f compose.staging-proxy.yml --profile maintenance up -d app scheduler
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/api/health/ready; then exit 0; fi
  sleep 2
done
cp -p compose.private-local.before-map-ux.yml compose.private-local.yml
docker compose -p homeintel-private -f compose.private-local.yml -f compose.staging-proxy.yml --profile maintenance up -d app scheduler
exit 1
