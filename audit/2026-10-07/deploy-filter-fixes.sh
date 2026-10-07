#!/usr/bin/env bash
set -euo pipefail
cd /opt/homeintel/release
docker load -i filter-repairs-image.tar
test "$(docker image inspect property-intelligence-sg:filter-repairs-20261007 --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = e16cd90169947d12dd9b4841ad0e946d96cf1a0f
docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,size=128m --entrypoint node property-intelligence-sg:filter-repairs-20261007 server/scripts/qualify-release-image.js
cp -p compose.private-local.yml compose.private-local.before-filter-repairs.yml
sed -i 's/property-intelligence-sg:project-coverage-20261007/property-intelligence-sg:filter-repairs-20261007/g' compose.private-local.yml
docker compose -p homeintel-private -f compose.private-local.yml -f compose.staging-proxy.yml --profile maintenance up -d app scheduler
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/api/health/ready; then exit 0; fi
  sleep 2
done
echo 'Readiness failed; restoring previous image configuration' >&2
cp -p compose.private-local.before-filter-repairs.yml compose.private-local.yml
docker compose -p homeintel-private -f compose.private-local.yml -f compose.staging-proxy.yml --profile maintenance up -d app scheduler
exit 1
