# blockAI

Minecraft統合版(26.51+)用のアドオン。AI村人に職業を与えて、村長として村を発展させる。安定版Script APIのみ使用（`@minecraft/server` 2.10.0 / server-ui 2.2.0）。`packs/BP`・`packs/RP`、スクリプトは `core/`（共通）と `jobs/`（1職業1ファイル）。変更したら版を上げて `npm run check` を通し、pushする（Releasesに `blockAI-v<版>.mcaddon`）。詳細は `.claude/rules/` を参照。
