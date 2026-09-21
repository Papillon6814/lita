# 引き継ぎメモ

> 次のセッションはここを読めば再開できます。

**最終更新**: 2026-09-22

## 前回やったこと

1. 逆質問で Lita の方向性を確定（広報発信向け・AI が書く前提・文体プロファイルが中核）
2. 技術選定を確定（Tauri v2 / Codex CLI サブプロセス / SQLite / Slack PKCE / MIT / 英語 UI）
3. リポジトリを初期化し、PM エージェントと状態ファイルの運用を敷いた
4. Notion に仕様ページを作成（正）
5. リポジトリを public + MIT で公開
6. **Codex 呼び出しの PoC を通した（Issue #1）** — 設計の前提は成立。ただし制約を3つ発見

## 次の一手（この順で）

1. **約30秒の待ち時間をどう扱うか決める（B-10 / D-19）** — ストリーミングが使えないので生成中は無音になる。UI を作る前にここを決めないと手戻りする
2. **Slack の権限要件の検証（B-02）** — `search.messages` が有料プラン必須かを確認する
3. **Voice スキーマの確定（B-04）** — PoC の出力を叩き台に、各フィールドへ `description` を付ける
4. **Slack App 作成と PKCE 有効化（B-03）** — 本人の手作業。取り消せない操作なので確定してから
5. **Tauri v2 スキャフォールド（B-05）** — 上記が固まってから

## 触る前に知っておくこと

- コード変更は必ず worktree + feature branch で行います。main 直コミットは禁止です。
- 決定を変えるときは、**Notion の決定事項表**と **`docs/pm/decisions.md`** の両方を更新します。
- Codex のトークンには触りません。`codex` を起動するだけです。
- `cargo run -p lita-codex --bin probe` を実行すると**アカウントの Codex 利用枠を消費します**（1回あたり約70秒・2リクエスト）。
- v0.1 の完成定義に入らない提案は backlog に落とします。

## Notion（正）へのリンク

- 仕様本体: https://www.notion.so/3e29cda8bea1809e9077d080a350d218
- 技術仕様: https://www.notion.so/3e29cda8bea18131a10dc9037e9fa189
- 引き継ぎメモ: https://www.notion.so/3e29cda8bea1810caf0ec83deebc4302
