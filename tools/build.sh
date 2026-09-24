#!/bin/sh
# packs/BP と packs/RP から dist/blockAI.mcaddon を作る
set -eu
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist
(cd packs && zip -qr ../dist/blockAI.mcaddon BP RP -x '*.DS_Store')
# 手動インストール用（iPhone の「ファイル」アプリで展開できるよう .zip 名でも置く）
# フォルダ名にバージョンを入れて、古いものと見分けやすくする
VER="$(node -p "require('./package.json').version")"
TMP="$(mktemp -d)"
cp -R packs/BP "$TMP/blockAI_BP_v$VER"
cp -R packs/RP "$TMP/blockAI_RP_v$VER"
(cd "$TMP" && zip -qr "$OLDPWD/dist/blockAI-manual.zip" "blockAI_BP_v$VER" "blockAI_RP_v$VER" -x '*.DS_Store')
rm -rf "$TMP"
echo "built dist/blockAI.mcaddon and dist/blockAI-manual.zip"
