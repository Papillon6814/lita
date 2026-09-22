# 引き継ぎメモ

> 次のセッションはここを読めば再開できます。

**最終更新**: 2026-09-22（書く画面を入れて v0.1 の一周が通った直後）

## 前回やったこと

1. 逆質問で Lita の方向性を確定（広報発信向け・AI が書く前提・文体プロファイルが中核）
2. 技術選定を確定（Tauri v2 / Codex CLI サブプロセス / SQLite / MIT / 英語 UI）
3. リポジトリを初期化して public + MIT で公開、PM エージェントと状態ファイルの運用を敷いた
4. Notion に仕様ページを作成（正）
5. **Codex 呼び出しの PoC を通した**（Issue #1 / PR #2）— 前提は成立。制約を3つ発見
6. **Slack の権限要件を検証した**（Issue #4 / PR #5）— Slack 側はほぼ塞がっていた。同時に **Voice は4件で安定する**ことを実測し、**v0.1 から Slack を外す判断に至った（D-20）**
7. **待ち時間を測り直した**（Issue #3）— **問題設定が誤っていた**。短文生成は6.6秒まで落ちる。生成中はインジケータのみ、推論量はユーザーが選べる形に決定（D-23〜D-26）。`Effort` と `--ignore-user-config` をラッパーに実装済み
8. **Voice スキーマを確定した**（Issue #7）— 部分集合4通り×3回の実測で、**引用を生成に渡すと構造化フィールドが無視され、過去の文が借用される**と判明。引用は保存のみ、生成には構造化フィールド11個だけを渡す（D-27〜D-30）。`voice.rs` に型として固定
9. **Tauri アプリの骨格を立てた**（Issue #9）— React + TS + Vite、`codex_status` コマンドで Codex の状態を表示。en/ja の i18n と `src/platform` 境界を敷設（D-31〜D-35）
10. **バックログ全 15 件を GitHub Issue 化した**（#11〜#25）
11. **保存方式をサーバへ転換した**。SQLite 実装（#11）の途中で「別 PC でも引き継ぎたい」要件が出て、オンライン専用・Google OAuth・v0.1 に含める、と決定（D-36〜D-39）。基盤候補 18 件を調査して Notion 子ページにまとめた。同日 **Supabase に決定（D-40）**
12. **Supabase にスキーマを適用し、Google ログインを実機で通し、API クライアント `lita-store` を作り、アプリ内サインインまで通した**（PR #27〜#31）
13. **貼り付け UI と note / Medium / X の取り込みを入れた**（PR #34、#35）
14. **UI/UX を作り直した**（PR #36）。4つのレビュースキルで批評 → Notion の「UI/UX レビュー」ページ → HTML モックで方向を4案 → 絞り込み → ハイエンド UX 批評を全反映、の順で見本を確定し、その通りに実装。見本は Claude Artifact（https://claude.ai/artifact/7m4i2ZmhNvQ1oMcZeJ1Mia）
15. **書く画面を入れた**（#13 / #14 / #16）。ブリーフ → 出す先と考える量 → 「Codex に送る内容をそのまま見る」 → 書く（中止可） → 下書きを直して「コピーして採用」。ブリーフと下書きはサーバに保存し、採用／破棄の状態を持つ。**v0.1 の完成定義の一周が通った**（本人確認済み）。（PR #27、#26）。Google はデスクトップ用クライアントでもシークレットを要求すると確定し、Supabase 経由の OAuth に切り替えた（D-41）。`crates/lita-auth` がログインとリフレッシュを担う

## いま決まっていること

v0.1 の入口は **本人の公開済みの発信（note → Medium → X アーカイブ）を取り込むこと**で、貼り付けはその受け皿です（D-43）。**Slack は凍結**しました（D-42。Marketplace 掲載の前提条件が個人 OSS では満たせない）。

データは **サーバが正、オンライン専用** です（D-36）。ログインは Google OAuth（D-37）。基盤は **Supabase（東京）** です（D-40）。

## 次の一手（この順で）

1. **実装後の UI 再レビュー（B-47）** — Voice → 書く → 採用までを 2026-09-22 の UX 批評と同じ基準で見直す
2. **未ログイン・利用上限の実地再現（B-11 / #17）** — stderr の文字列マッチを確かな判定に置き換える
3. **Voice の一文の精度（B-45）** — 長文・英語の Voice で不自然にならないか
4. 公開前の運用: Google 同意画面を Testing → 本番へ。未使用の「Lita desktop」クライアントは削除候補

## 触る前に知っておくこと

- コード変更は必ず worktree + feature branch で行います。main 直コミットは禁止です。worktree を切ったら `npm install` を忘れずに。
- `@tauri-apps/*` を import してよいのは `src/platform/` だけです（D-32）。
- **見た目の正は Claude Artifact のモック**（https://claude.ai/artifact/7m4i2ZmhNvQ1oMcZeJ1Mia）と `src/App.css` のトークンです。ライトのみ、生成りの紙色、ミント1色（文字と塗りは濃い #1d7f70、淡色は背景と縁取りだけ）、角丸は操作部品 8px / 入れ物 12px、書体は Zen Kaku Gothic New（`@fontsource` で同梱）。新しい画面はこのトークンだけで組みます。
- UI の原則（2026-09-22 の UX 批評で決定）: 正常時の状態表示は出さない（異常時だけ琥珀色のピル）。数字や内部制約を見せない（「足りているか」で言う）。エラーは平易な一文＋「詳細を表示」。Voice の一文の主語は常に「あなたの文章は」。名前は既定名で後から変える。
- 決定を変えるときは、**Notion の決定事項表**と **`docs/pm/decisions.md`** の両方を更新します。覆った決定は消さず「（日付 改訂）」を付けて残します。
- Codex のトークンには触りません。`codex` を起動するだけです。
- `cargo run -p lita-codex --bin probe` / `--bin corpus` / `--bin schema` は**アカウントの Codex 利用枠を消費します**（約70秒／約60秒／約3分）。
- アプリの Supabase URL と anon key は `src-tauri/src/config.rs` の定数です。どちらも公開値で、セルフホストする人はここを変えます。セッションは OS キーチェーン（service `com.papillon6814.lita`）にあり、起動時にリフレッシュしてから UI に渡します。
- データアクセスは `lita-store::Store::as_user(access_token)` 経由のみ。RLS が所有者チェックを担うので、クレート側でユーザー絞り込みはしない。`cargo run -p lita-store --example roundtrip` で本番に対する一周検証ができる（ブラウザでのログインが1回要る。後始末込み）
- Voice の生成プロンプトには必ず `VoiceProfile::generation_view()` を使ってください。プロファイル全体を渡してはいけません（D-28）。投稿の生成は `lita-codex::post::generation_prompt` が組み、アプリの `preview_prompt` はそれと同じ文字列を返します（見せているものと送るものを一致させる）。
- v0.1 の完成定義に入らない提案は backlog に落とします。
- SQLite に戻す提案が出たら、まず D-36 の理由（別 PC での引き継ぎ）を確認してください。ローカル優先＋同期は保留項目（B-31）です。
- backlog の各項目は GitHub Issue（#11〜#25、マイルストーン v0.1 / v0.2、ラベル `backlog` / `deferred`）と1対1で対応しています。着手時は該当 Issue を自分にアサインし、新しい項目は backlog.md と Issue の両方に追加します。

## Google Cloud（2026-09-22 作成）

- プロジェクト `lita-509404`（組織 muumoo.online）。同意画面は External / Testing、テストユーザーは kuno@muumoo.online のみ。**公開前に同意画面を本番に切り替える必要がある**
- OAuth クライアント: 「Lita (Supabase)」（Web application、使用中）と「Lita desktop」（Desktop app、方式 A の検証用で未使用）。ID とシークレットはキーチェーン `lita-google-web-client-*` / `lita-google-client-*`

## Supabase（2026-09-22 作成）

- 組織: `muumoo`（slug `swsrpyuhcrycgcolxaig`、Free プラン）。既存の「finn Org」には作成権限がなかったため新設
- プロジェクト: `lita`、ref `csfvqpqzvcorqlsmfjwb`、東京 ap-northeast-1、Postgres 17。ダッシュボード https://supabase.com/dashboard/project/csfvqpqzvcorqlsmfjwb
- DB パスワードは macOS キーチェーン（service `lita-supabase-db-password`、account `lita`）。リポジトリにも Notion にも書かない
- Google プロバイダは `supabase/config.toml` の `[auth.external.google]` で管理し、`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` を環境変数にして `supabase config push` で反映する（Storage 設定の読み取りエラーが出るが認証設定は適用される。CLI 更新で消える見込み）
- CLI は `--profile <name>` で複数アカウントを切り替えられる。別アカウントを使うときは本人が `supabase login --profile <name>` を対話で実行する
- `supabase/` はリポジトリにある（`config.toml` とマイグレーション）。worktree を切ったら `supabase link --project-ref csfvqpqzvcorqlsmfjwb` を再実行する（`.temp` は gitignore）。スキーマ変更は新しいマイグレーションファイルを足して `supabase db push`

## Notion（正）へのリンク

- 仕様本体: https://www.notion.so/3e29cda8bea1809e9077d080a350d218
- 技術仕様: https://www.notion.so/3e29cda8bea18131a10dc9037e9fa189
- 引き継ぎメモ: https://www.notion.so/3e29cda8bea1810caf0ec83deebc4302
