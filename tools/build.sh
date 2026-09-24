#!/bin/sh
# packs/BP と packs/RP から dist/blockAI.mcaddon を作る
set -eu
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist
(cd packs && zip -qr ../dist/blockAI.mcaddon BP RP -x '*.DS_Store')
# 手動インストール用（iPhone の「ファイル」アプリで展開できるよう .zip 名でも置く）
cp dist/blockAI.mcaddon dist/blockAI-manual.zip
echo "built dist/blockAI.mcaddon and dist/blockAI-manual.zip"
