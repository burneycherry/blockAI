# 構成と仕組み

## ファイル
- `packs/BP/scripts/main.js`：イベント登録、0.5秒ごとのメインループ
- `core/config.js`：定数（版、レベル表、所持数、作業間隔）
- `core/registry.js`：職業の登録所 `registerJob()`、`JobDef`・`WorkContext` の型、今後の職業の紹介 `PLANNED_JOBS`
- `core/villager.js`：村人の状態機械（idle → to_task → working → to_storage → depositing）、経験値・持ち物・道具袋・作業設定
- `core/tasks.js`：仕事の検索（`system.runJob` で少しずつ）、仕事とマーカーの管理
- `core/village.js`：村データ（ワールドのダイナミックプロパティ）、村レベル、職業ごとの仕事場、立ち入り禁止エリア
- `core/loading.js`：`world.tickingAreaManager` で村と仕事場を常に読み込む
- `core/ui.js`：村長メニュー・村人メニュー（server-ui のフォーム）
- `core/blocks.js`：座標・ブロックの共通処理
- `jobs/lumberjack.js`（基本パック）、`jobs/farmer.js`（農業パック予定）、`jobs/index.js` で読み込む

## 村人の移動
- 統合版には「指定位置へ歩け」のAPIが無い。そのため、見えないマーカー（`blockai:wp_task` / `blockai:wp_storage`）を置き、村人が `nearest_attackable_target` と `melee_attack` でそれを追いかけて、本物の経路探索で歩く
- 職業ごとに枠（スロット、16個）があり、`blockai:mode_to_slot_N` で枠Nのマーカーだけを追う。定義は `tools/gen-entities.mjs` で生成する
- 目的地に12秒近づけなければワープする。プレイヤーが40ブロック以内にいないときは、移動と作業を省略して一気に処理する
- 追いかけ対象をリセットするため、倉庫マーカーは納品のたびに作り直す

## 職業の追加
`jobs/xxx.js` で `registerJob({ id, name, skin, pack, status, scan, work, options, skills, onStorage, needsSupply })` を呼び、`jobs/index.js` に import を足す。`scan` は1列の一番上のブロックから仕事を `addTask(stand, blocks, data)` で登録する。`work(ctx)` はこなした数を返す。
