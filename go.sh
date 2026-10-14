#!/usr/bin/env bash
# Установка одной командой (из VNC-консоли):
#   curl -sL https://raw.githubusercontent.com/zeus199191/boomcrm/main/go.sh | bash
set -e
cd /root
rm -rf boomcrm boomcrm-main boomcrm.tar.gz
curl -fsSL -o boomcrm.tar.gz https://codeload.github.com/zeus199191/boomcrm/tar.gz/refs/heads/main
tar xzf boomcrm.tar.gz
mv boomcrm-main boomcrm
cd boomcrm
bash install.sh "$@"
