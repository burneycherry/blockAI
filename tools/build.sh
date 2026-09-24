#!/bin/sh
# packs/BP と packs/RP から dist/blockAI.mcaddon を作る
set -eu
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist
VER="$(node -p "require('./package.json').version")"
# iPhone/iPad はファイル名ごとに取り込み結果を覚えてしまうので、名前に版を入れる
(cd packs && zip -qr "../dist/blockAI-v$VER.mcaddon" BP RP -x '*.DS_Store')
ls dist
