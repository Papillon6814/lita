# 発信プロフィール（#137、D-78）

- 作成日: 2026-09-27 ／ 最終更新: 2026-09-29
- ブランチ: `feat/publishing-profiles`
- 要件: `docs/pm/requirements/2026-09-27-publishing-profiles.md` ／ UX: `docs/pm/ux/2026-09-27-publishing-profiles.md`、レビュー `docs/pm/ux/2026-09-27-publishing-profiles-review.md`
- 計画: `docs/superpowers/plans/2026-09-27-publishing-profiles.md`

## 一言サマリー

実装・単体テスト・移行 SQL の使い捨て DB での検証・モックでの UX レビューまで済みました。本番 DB への migration 適用と、実データでの確認（受け入れ条件 2・3・6・7）は本人の承認待ちで、まだやっていません。

## やったこと

- DB（`supabase/migrations/20260927100000_publishing_profiles.sql`）: `publishing_profiles`、`profile_settings`（方針・雲・既定の文体）、`user_settings.active_profile_id` を追加。既存行は ID を変えずに、ユーザーごとの初期プロフィール 1 つへ割り当てる。Voice・元にした文章・記事・版には `profile_id` と、同じプロフィール内だけを参照できる複合外部キーを付けた。移行前に所有者をまたぐ古い参照を見つけたら、何も変えずに中止する。
- `lita-store`: `UserStore`（プロフィール一覧・作成・改名・選択、アカウント全体のキュー）と、`ProfileStore`（1 つのプロフィールに固定した読み書き）に分けた。
- Tauri: プロフィールのコマンドを追加し、画面からの操作は選択中のプロフィールに絞った。キューは画面の選択と関係なく、記事ごとの所有プロフィールで動く。
- 画面: サイドバー最上部の切替器、改名、名前入力必須の新規作成。切替前に編集中の内容を保存し、失敗したら切り替えない。一覧のキャッシュはプロフィールごとに持つ。

## 実行したコマンドと結果（2026-09-29）

- `cargo test --workspace` → 145 passed, 0 failed
- `cargo clippy --workspace --all-targets` → 警告は `lita-codex` の既存 8 件だけ（今回の差分とは無関係）
- `npm run build`（tsc + vite）→ 成功
- `supabase/tests/publishing_profiles_migration.sql` を使い捨ての PostgreSQL 17（`/tmp/lita-profiles-fixture.*`、`psql --single-transaction`）で実行:
  - 正常系 → `PASS`（ID・内容・参照・キュー・方針・雲を保持、初期プロフィール 1 つ、プロフィールをまたぐ参照は拒否、RLS・GRANT）
  - 異常データ 4 種（記事→他人の Voice、設定→他人の Voice、他人の元にした文章、他人の版）→ 4 種とも中止し、テーブルは残らない

## 受け入れ条件ごとの判定

| 条件 | 確かめ方 | 判定 |
|---|---|---|
| 1. 切替器・初期プロフィール・名前必須の作成 | モックの画像、`profile_creation_trims_and_rejects_blank_names`、移行テスト | ◯（改名・作成の流れの画像は未撮影） |
| 2. プロフィール間のデータ分離 | 複合外部キーと RLS（移行テスト）、クエリがプロフィールで絞られること（単体テスト） | △ 実データで未確認 |
| 3. 既存データの移行 | 使い捨て DB の移行テスト | ◎ |
| 4. 保存成功後に切り替える | モックでの観察、`stale_profile_selection_commit_cannot_change_active_profile` | ◯ |
| 5. 保存失敗なら切り替えない | モックの画像と観察 | ◎ |
| 6. キューは元のプロフィールのまま | `stopping_one_profile_does_not_cancel_another_profiles_active_job`、`queue_completion_patch_is_profile_scoped…` ほか | △ 実データで未確認 |
| 7. ログイン 1 つで再起動後も選択を復元 | `active_profile_id` の保存（単体テスト） | △ 実機で未確認 |

## 次のアクション

- [ ] 本番 DB に migration を適用する（本人の承認が必要）
- [ ] 本番で `cargo run -p lita-store --example roundtrip`（2 つ目のプロフィールが必要。本人の承認が必要）
- [ ] 実機で確認: A・B に別の内容を置いて切り替える（条件 2）、再起動後に選択が戻る（条件 3・7）、A のキュー実行中に B へ切り替える（条件 6）
- [ ] PR を出して lita-ux の最終確認、マージ、リリース

## リスク

| リスク | 対応 |
|---|---|
| 本番に所有者をまたぐ古い参照があると migration が中止する | 中止してもデータは変わらない。エラーに出た行を本人と確認して直してから再実行 |
| 古いアプリ（v0.2.x）が migration 後の DB に書くと、`profile_id` がなくて失敗する | migration の適用とアプリの更新を同じ日に行う |
