#!/bin/sh
# packs/BP と packs/RP から dist/blockAI.mcaddon を作る
set -eu
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist
(cd packs && zip -qr ../dist/blockAI.mcaddon BP RP -x '*.DS_Store')
echo "built dist/blockAI.mcaddon"
