# ビルド・リリース・版の管理

- 変更したら、必ず次の5か所の版を同じ値に上げる：`package.json`、`core/config.js` の `VERSION`、BP/RP の `manifest.json`（header・module・依存）、BP/RP の `manifest` の name と `texts/*.lang` の `pack.name`（例 `v0.11.2`）。ずれていると `tools/validate.mjs` がエラーを出す
- `npm run check` を通す：tsc の型チェック、生成物が最新か（`gen-entities` / `gen-tree` の `--check`）、JSON・構文・版のチェック
- エンティティ定義を変えたら `node tools/gen-entities.mjs` / `node tools/gen-tree.mjs` で作り直す（`villager.json`・`wp_task.json`・倒木関係は生成物なので手で直さない）
- pushすると GitHub Actions が Releases の `latest-<ブランチ名>` に `blockAI-v<版>.mcaddon`（配布用）と `blockAI-test-v<版>.zip`（テスト用）を置く。古いファイルは消す
- テスト用 zip は `tools/make-test.mjs` が作る。フォルダ名 `blockAI_BP`/`blockAI_RP` と版 `[0,0,1]` を固定し、UUID は配布版と同じ。ユーザーは iPad の `development_*_packs` に上書きしてテストする（古い版が溜まらず、ワールドへの付け直しも不要）
- 作業ブランチ：`claude/wonderful-goodall-ulkib1`
