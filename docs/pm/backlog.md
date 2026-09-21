# バックログ

> 優先順。「後回し（意図的に保留）」は日付つきで分けて書きます。

## v0.1 に必要（優先順）

- [ ] **B-01 Codex 呼び出しの PoC** — Rust から `codex exec --json --output-schema --sandbox read-only --skip-git-repo-check` を起動し、型付き JSON を受け取る。`codex` 未インストール／未ログインの検出も含める。**ここが崩れると設計全体が崩れるので最優先**
- [ ] **B-02 Slack の権限要件の検証** — `search.messages` が有料プラン必須かを確認する（未検証）。必須なら `conversations.history` + 自分の user_id フィルタへフォールバックする設計にする
- [ ] **B-03 Slack App の作成と PKCE 有効化** — 本人の手作業。`pkce_enabled: true`、redirect_urls に `lita://oauth`、user scopes を確定。**PKCE の有効化は取り消せない一方向の操作**である点に注意
- [ ] **B-04 Voice プロファイルのスキーマ確定** — B-01 で実際に文体抽出させ、出てきた項目から逆算して確定する
- [ ] **B-05 Tauri v2 スキャフォールド** — `tauri-plugin-deep-link`、SQLite、keyring を含む最小構成
- [ ] **B-06 SQLite スキーマ設計** — Voice / VoiceSource / Brief / Draft / Platform
- [ ] **B-07 ブリーフ入力 → 生成 → 承認 → コピーの UI**
- [ ] **B-08 送信内容の可視化** — 何が OpenAI に送られるかを生成前に見せる
- [ ] **B-09 GitHub への push と公開**

## v0.2 以降（意図的に保留）

- [ ] B-20 記事 URL を文体ソースにする（2026-09-22 保留）
- [ ] B-21 note / Medium 向けの長文出力（2026-09-22 保留）
- [ ] B-22 複数 Voice の使い分け（2026-09-22 保留）
- [ ] B-23 生成履歴の一覧と再編集（2026-09-22 保留）
- [ ] B-24 Publisher プラグイン（下書き保存・投稿）（2026-09-22 保留）
- [ ] B-25 Provider 抽象化（Codex 以外のバックエンド）（2026-09-22 保留）
- [ ] B-26 配布まわり（コード署名・公証・Homebrew cask）（2026-09-22 保留）

## 完了

- [x] **B-00 リポジトリ初期化と PM 運用の土台** — 2026-09-22 完了。LICENSE / README / .gitignore / `.claude/agents/lita-pm.md` / `docs/pm/` を作成
