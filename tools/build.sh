#!/bin/sh
# packs/BP と packs/RP から dist/blockAI.mcaddon を作る
set -eu
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist
VER="$(node -p "require('./package.json').version")"
# iPhone/iPad はファイル名ごとに取り込み結果を覚えてしまうので、名前に版を入れる
(cd packs && zip -qr "../dist/blockAI-v$VER.mcaddon" BP RP -x '*.DS_Store')
# 手動インストール用（iPhone の「ファイル」アプリで展開できるよう .zip 名でも置く）
# フォルダ名にバージョンを入れて、古いものと見分けやすくする
TMP="$(mktemp -d)"
cp -R packs/BP "$TMP/blockAI_BP_v$VER"
cp -R packs/RP "$TMP/blockAI_RP_v$VER"
(cd "$TMP" && zip -qr "$OLDPWD/dist/blockAI-v$VER-manual.zip" "blockAI_BP_v$VER" "blockAI_RP_v$VER" -x '*.DS_Store')
rm -rf "$TMP"
ls dist
