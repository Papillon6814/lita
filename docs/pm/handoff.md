# 引き継ぎメモ

> 次のセッションはここを読めば再開できます。

**最終更新**: 2026-09-22（保存方式をサーバへ転換した直後）

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

## いま決まっていること

v0.1 の入口は **Slack 連携ではなく「気に入っている文章を20件ほど貼る」** です。Slack ボタン連携（PKCE + `lita://oauth`）は v0.2 以降に延期しました。

データは **サーバが正、オンライン専用** です（D-36）。ログインは Google OAuth（D-37）。基盤は **Supabase（東京）** です（D-40）。

## 次の一手（この順で）

1. **Google Cloud の OAuth クライアント（Desktop app）を作る（B-41）** — Supabase 側は作成済み（下記）。Google 側はブラウザ操作エージェントで作成中
2. **Google ログインの実機検証（B-30 / #26）** — Desktop app クライアント＋ループバック＋PKCE
3. **サーバ側スキーマと API クライアント（B-06 / #11）** — `feat/11-sqlite` の設計を `user_id` 付きで移植
4. **貼り付け／ファイル取り込みの UI（B-12 / #12）** — v0.1 の入口。文章を受け取って `VoiceProfile::extraction_prompt` に渡す
5. **ブリーフ → 生成 → 承認 → コピーの UI（B-07 / #13）**、速度／品質の切り替え（B-13 / #14）、Voice 生成のステージ表示（B-14 / #15）

## 触る前に知っておくこと

- コード変更は必ず worktree + feature branch で行います。main 直コミットは禁止です。worktree を切ったら `npm install` を忘れずに。
- `@tauri-apps/*` を import してよいのは `src/platform/` だけです（D-32）。
- 決定を変えるときは、**Notion の決定事項表**と **`docs/pm/decisions.md`** の両方を更新します。覆った決定は消さず「（日付 改訂）」を付けて残します。
- Codex のトークンには触りません。`codex` を起動するだけです。
- `cargo run -p lita-codex --bin probe` / `--bin corpus` / `--bin schema` は**アカウントの Codex 利用枠を消費します**（約70秒／約60秒／約3分）。
- Voice の生成プロンプトには必ず `VoiceProfile::generation_view()` を使ってください。プロファイル全体を渡してはいけません（D-28）。
- v0.1 の完成定義に入らない提案は backlog に落とします。
- SQLite に戻す提案が出たら、まず D-36 の理由（別 PC での引き継ぎ）を確認してください。ローカル優先＋同期は保留項目（B-31）です。
- backlog の各項目は GitHub Issue（#11〜#25、マイルストーン v0.1 / v0.2、ラベル `backlog` / `deferred`）と1対1で対応しています。着手時は該当 Issue を自分にアサインし、新しい項目は backlog.md と Issue の両方に追加します。

## Supabase（2026-09-22 作成）

- 組織: `muumoo`（slug `swsrpyuhcrycgcolxaig`、Free プラン）。既存の「finn Org」には作成権限がなかったため新設
- プロジェクト: `lita`、ref `csfvqpqzvcorqlsmfjwb`、東京 ap-northeast-1、Postgres 17。ダッシュボード https://supabase.com/dashboard/project/csfvqpqzvcorqlsmfjwb
- DB パスワードは macOS キーチェーン（service `lita-supabase-db-password`、account `lita`）。リポジトリにも Notion にも書かない
- CLI は `--profile <name>` で複数アカウントを切り替えられる。別アカウントを使うときは本人が `supabase login --profile <name>` を対話で実行する
- `supabase link --project-ref csfvqpqzvcorqlsmfjwb` はまだしていない（B-06 で `supabase init` と一緒に行う）

## Notion（正）へのリンク

- 仕様本体: https://www.notion.so/3e29cda8bea1809e9077d080a350d218
- 技術仕様: https://www.notion.so/3e29cda8bea18131a10dc9037e9fa189
- 引き継ぎメモ: https://www.notion.so/3e29cda8bea1810caf0ec83deebc4302
