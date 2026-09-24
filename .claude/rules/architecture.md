# 構成と仕組み

## ファイル
- `packs/BP/scripts/main.js`：イベント登録（杖・村人/倉庫のタップ・ダメージ打ち消し・倒れた村人）、0.5秒ごとのメインループ、毎tickの手引き
- `core/config.js`：定数（版、レベル表、所持数、作業間隔）
- `core/registry.js`：職業の登録所 `registerJob()`、`JobDef`・`WorkContext` の型、今後の職業の紹介 `PLANNED_JOBS`
- `core/villager.js`：村人の状態機械（idle → to_task → working → to_storage → depositing、夜は to_bed → sleeping / to_rest → resting）、経験値・体力・持ち物・道具袋・作業設定・見た目の反映・手引き（tickAssist）
- `core/tasks.js`：仕事の検索（`system.runJob` で少しずつ）、仕事とマーカーの管理
- `core/village.js`：村データ（ワールドのダイナミックプロパティ）、村レベル、職業ごとの仕事場、立ち入り禁止エリア
- `core/loading.js`：`world.tickingAreaManager` で村と仕事場を常に読み込む
- `core/ui.js`：村長メニュー・村人メニュー（server-ui のフォーム）
- `core/blocks.js`：座標・ブロックの共通処理
- `core/characters.js`：キャラクター20人の定義（`tools/gen-humans.mjs` もここを読む）
- `core/beds.js`：夜の判定、ベッド探しと割り当て、ベッドの目印（`blockai_wp_home`）
- `core/life.js`：倒れたときの記録と、翌朝の復活
- `core/storage.js`：村の倉庫。専用の倉庫（`blockai:storehouse`、family に `blockai_wp_storage` を持つので村人はそれ自体を目指す）は複数置けて中身は共有（ワールドの `blockai:stock`）。容量はマス単位（種類ごとに64個で1マス）。倉庫が無いときだけ旧方式のチェスト。職業は `StoreSource`（count/take）で材料を持ち出す
- `core/icons.js`：メニューに出すアイテムの絵（バニラのテクスチャの場所。取れるAPIが無いので村で扱う物だけ手で書く）
- `core/storage-ui.js`：倉庫のメニュー（取り出す・しまう・片付ける・チェストから移す）と設置。見た目は `tools/gen-storehouse.mjs`（ふたは `blockai:open` で開く）
- `jobs/lumberjack.js`（基本パック）、`jobs/farmer.js`（農業パック予定）、`jobs/index.js` で読み込む

## 村人の移動
- 統合版には「指定位置へ歩け」のAPIが無い。そのため、見えないマーカー（`blockai:wp_task` / `blockai:wp_storage`）や倉庫そのものを目標にし、村人が `nearest_attackable_target` と `melee_attack` でそれを追いかけて、本物の経路探索で歩く
- 職業ごとに枠（スロット、16個）があり、`blockai:mode_to_slot_N` で枠Nのマーカーだけを追う。定義は `tools/gen-entities.mjs` で生成する
- 見られている間に4秒近づけなければ「手引き」（`tickAssist`：毎tick少しずつ teleport して地面沿いに歩かせる）に切り替え、それでも12秒近づけなければワープする。手引きが壁や葉で進めなくなったら、待たずにすぐワープする。プレイヤーが40ブロック以内にいないときは、移動と作業を省略して一気に処理する
- 追いかけ対象をリセットするため、倉庫マーカーは納品のたびに作り直す

## 見た目
- `tools/gen-humans.mjs` がモデル（絵は `tools/human-art.mjs`：リアル寄りの陰影付きドット絵。64配置を2倍の128x128で描く。モデルの UV は64のまま）（3体型）・テクスチャ（キャラクター×衣装の全組み合わせを合成済みで書き出す）・描画・アニメーション・クライアント側の定義を生成する。手で直さない
- 衣装を増やすときは `OUTFITS` に足し、職業の `skin` をその番号にする。道具（斧・鎌）や麦わら帽子のつばはモデルの部品で、`part_visibility` で出し分ける
- ほっそり体型は `animation.blockai.human.slim` のスケールで胴・腕・脚を細くする（テクスチャ配置は変えない）。顔はユーザーの参考スキンに合わせたリアル寄り（アニメ風は不採用）。女性と一部の男性は、帽子の層の前面に横髪と前髪を描いて小顔に見せる。目・目線・眉・口は `characters.js` の `face` で一人ずつ変える（全員同じ目は不気味と言われた）
- 作業のアニメーションは、スクリプトの `playAnimation("animation.blockai.human.swing")` で再生する

## 生成ツール
- `tools/gen-entities.mjs`（村人の行動グループ・体力段階・マーカー）、`tools/gen-tree.mjs`（倒木）、`tools/gen-humans.mjs` + `tools/human-art.mjs`（村人の見た目）、`tools/gen-storehouse.mjs`（倉庫の見た目・音）、`tools/make-test.mjs`（テスト用zip）、`tools/png.mjs`（PNG書き出し）

## 職業の追加
`jobs/xxx.js` で `registerJob({ id, name, skin, pack, status, reach, scan, work, options, skills, onStorage, needsSupply })`（skin は衣装番号、reach は作業を始められる距離、onStorage は `StoreSource` から材料を持ち出す） を呼び、`jobs/index.js` に import を足す。`scan` は1列の一番上のブロックから仕事を `addTask(stand, blocks, data)` で登録する。`work(ctx)` はこなした数を返す。
