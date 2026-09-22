# Codex の未ログイン・利用上限の実地再現（2026-09-22、#17 / B-11）

> `classify()` が stderr の文字列マッチだけに頼っていたのを、実機で再現して確かな信号に置き換えた記録。対象は codex-cli 0.155.1。

## 分かったこと

| 状態 | 再現方法 | 確かな信号 | 確度 |
| --- | --- | --- | --- |
| 未ログイン | `CODEX_HOME=$(mktemp -d) codex exec --json …`（空のホーム＝資格情報なし） | (1) `codex login status` が **終了コード 1**（約 10 ms、ネットワーク不要）。(2) `codex exec --json` は 5 回再接続を試みたあと（約 10 秒）、stdout の JSONL に `{"type":"turn.failed","error":{"message":"unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, …"}}` を出して exit 1 | 高（実機） |
| 利用上限 | 本人のアカウントでは再現不可（枠がある） | `{"type":"turn.failed","error":{"message":"You've hit your usage limit. … or try again at <日時>."}}` と、その前の `{"type":"error","message":…}`。openai/codex の公開 issue に複数の実例 | 中（公開実例。実機未確認） |
| 機械可読コード | — | app-server プロトコルには `CodexErrorInfo`（`unauthorized` / `usageLimitExceeded` …）があるが、`codex exec --json` の `turn.failed` には **まだ載っていない**（0.155.1 で確認。要望 issue openai/codex#22570 が open） | 高 |

stderr は `tracing` のログで、書式がリリースごとに変わる。判定の主にはしない。

## 実装

- `CodexCli::logged_in()`: `codex login status` の終了コードを見る。`run_typed` は実行前にこれを呼び、未ログインなら **`exec` を起動せずに** `NotLoggedIn` を返す（10 秒の再接続待ちを省く）
- `turn_failure(events)`: イベントストリームの `turn.failed`（なければ最後の `error`）から `message` と、あれば `codexErrorInfo` を取り出す
- `classify(failure, stderr)`: `codexErrorInfo` → `turn.failed` の message → stderr の順に見る。401 / unauthorized / missing bearer → 未ログイン、usage limit / rate limit / 429 → 利用上限
- `RunFailure.message` に Codex 自身の文言を保持し、UI の「詳細を表示」に出す
- 再現ツール: `cargo run -p lita-codex --example nologin`（枠を消費しない。数十 ms で NotLoggedIn が返れば正常）

## 残り

- 利用上限は実機で一度も踏んでいない。踏んだときに `turn.failed` の文言が想定どおりか、`docs/pm` に追記する
- `codexErrorInfo` が `exec --json` に載ったら、文字列マッチを外して機械可読コードだけにする
