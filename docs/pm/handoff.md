# 引き継ぎメモ

> 次のセッションはここを読めば再開できます。

**最終更新**: 2026-09-22

## 前回やったこと

1. Lita の方向性を逆質問で確定（広報発信向け・AI が書く前提・文体プロファイルが中核）
2. 技術選定を確定（Tauri v2 / Codex CLI サブプロセス / SQLite / Slack PKCE / MIT / 英語 UI）
3. リポジトリを初期化し、PM エージェントと状態ファイルの運用を敷いた
4. Notion に仕様ページを作成（正）
5. リポジトリを public + MIT で公開（https://github.com/Papillon6814/lita）

## 次の一手（この順で）

1. **Codex 呼び出しの PoC** — `codex exec --json --output-schema` を Rust から叩き、型付き JSON が返ることを確認する。ここが崩れると設計全体が崩れる
2. **Slack の権限要件の検証** — `search.messages` が有料プラン必須かを確認し、必要なら `conversations.history` へのフォールバックを設計に入れる
3. **Voice スキーマの確定** — PoC で実際に Codex に文体抽出させてみて、出てくる項目から逆算する
4. **Tauri v2 スキャフォールド** — 上記が固まってから

## 触る前に知っておくこと

- コード変更は必ず worktree + feature branch で行う（main 直コミット禁止）
- 決定を変えるときは Notion の決定事項表と `docs/pm/decisions.md` の両方を更新する
- Codex のトークンには絶対に触らない。`codex` を起動するだけ

## Notion（正）へのリンク

- 仕様本体: https://www.notion.so/3e29cda8bea1809e9077d080a350d218
- 技術仕様: https://www.notion.so/3e29cda8bea18131a10dc9037e9fa189
- 引き継ぎメモ: https://www.notion.so/3e29cda8bea1810caf0ec83deebc4302
