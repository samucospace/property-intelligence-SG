#!/usr/bin/env bash
set -euo pipefail
. /etc/os-release
[ "$ID" = ubuntu ] && [ "$VERSION_ID" = 24.04 ] || { echo 'Unsupported host OS'; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.asc ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
fi
if [ ! -f /etc/apt/sources.list.d/docker.sources ]; then
  cat >/etc/apt/sources.list.d/docker.sources <<DOCKER
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
DOCKER
fi
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
if ! id homeintel >/dev/null 2>&1; then useradd --create-home --shell /bin/bash homeintel; fi
usermod -aG docker homeintel
install -d -m 0700 -o homeintel -g homeintel /home/homeintel/.ssh
if [ ! -f /home/homeintel/.ssh/authorized_keys ]; then
  install -m 0600 -o homeintel -g homeintel /root/.ssh/authorized_keys /home/homeintel/.ssh/authorized_keys
fi
install -d -m 0750 -o homeintel -g homeintel /opt/homeintel
install -d -m 0700 /opt/homeintel/config
install -d -m 0700 -o 1000 -g 1000 /opt/homeintel/data /opt/homeintel/privacy /opt/homeintel/privacy-replica /opt/homeintel/backup-keys
install -d -m 0750 -o homeintel -g homeintel /opt/homeintel/release
# Existing SSH authentication policies and existing service data are untouched.
docker version --format '{{.Server.Version}}'
docker compose version
