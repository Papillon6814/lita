# 発信プロフィール（#137、D-78）

- 作成日: 2026-09-27 ／ 最終更新: 2026-09-29
- ブランチ: `feat/publishing-profiles`
- 要件: `docs/pm/requirements/2026-09-27-publishing-profiles.md` ／ UX: `docs/pm/ux/2026-09-27-publishing-profiles.md`、レビュー `docs/pm/ux/2026-09-27-publishing-profiles-review.md`
- 計画: `docs/superpowers/plans/2026-09-27-publishing-profiles.md`

## 一言サマリー

実装・単体テスト・移行 SQL の使い捨て DB での検証・モックでの UX レビューを済ませ、PR #138 をマージしました。2026-09-29 に本番 DB へ migration を適用し、v0.2.25 として公開しました。同日、受け入れ条件 2・3・6・7 を本番と実機（v0.2.25）で確かめ、すべて満たしました。

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
| 1. 切替器・初期プロフィール・名前必須の作成 | 実機: 名前が空のまま作成を押しても作られない（DB も増えない）。名前を入れると作成され、切替器に表示されて選択される | ◎ |
| 2. プロフィール間のデータ分離 | 本番 roundtrip（kuno@muumoo.online）: 選んでいないプロフィールの Voice・記事・方針・雲が一覧と設定に出ない。別プロフィールの ID を使う書き込みは拒否。実機: 新しいプロフィールは空の状態で、Profile 1 の記事・文体が出ない | ◎ |
| 3. 既存データの移行 | 使い捨て DB の移行テスト、本番適用後の行数と中身の照合 | ◎ |
| 4. 保存成功後に切り替える | モックでの観察、`stale_profile_selection_commit_cannot_change_active_profile` | ◯（実機では未確認） |
| 5. 保存失敗なら切り替えない | モックの画像と観察 | ◎ |
| 6. キューは元のプロフィールのまま | 実機: Profile 1 で 1 本積み、`writing` になってから B へ切替（DB の選択も B）。約 2 分後に完了し、本文 2,136 字と版 1 つは Profile 1 の記事にだけ入った。B の記事・版・設定（`updated_at` 含む）は変化なし。Profile 1 に戻ると一覧に結果が出た | ◎ |
| 7. ログイン 1 つで再起動後も選択を復元 | 本番 roundtrip で選択の保存と読み戻し。実機: B を選んだまま終了して起動し直すと B が選ばれていた | ◎ |

確認の進め方（2026-09-29）: roundtrip は Google ログインの代わりに、管理者 API で本人のセッションを発行し、リポジトリ外の一時クレートで実行しました。実機は macOS のアクセシビリティ（System Events の AXPress）で操作し、結果は DB を読んで判定しました。確認用に作ったプロフィール 2 つと生成した記事 1 本は、DB から削除済みです。

## 次のアクション

- [x] 本番 DB に migration を適用（2026-09-29）。適用前に `public` を `pg_dump` で退避。適用後、各テーブルの行数は適用前と一致し、全行に `profile_id` が付いた（プロフィール 2・Voice 2・元にした文章 4・記事 1・版 1）。方針・雲は適用前と同じ中身
- [x] PR #138 をマージし、v0.2.25 を公開（2026-09-29）
- [x] 実機と本番で条件 2・3・6・7 を確認（2026-09-29、上の表）
- [ ] roundtrip の最後の確認を直す（lita-dev）。anon でのプロフィール一覧は「空」を期待しているが、実際は GRANT がないため 401（42501）で拒否される。拒否のほうが migration の意図どおりなので、期待を「拒否または空」に改める

## リスク

| リスク | 対応 |
|---|---|
| 本番に所有者をまたぐ古い参照があると migration が中止する | 中止してもデータは変わらない。エラーに出た行を本人と確認して直してから再実行 |
| 古いアプリ（v0.2.x）が migration 後の DB に書くと、`profile_id` がなくて失敗する | migration の適用とアプリの更新を同じ日に行う |
