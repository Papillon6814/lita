# Google ログインの実機検証（Issue #26）

> 2026-09-22。Google の Desktop app クライアント＋ループバック＋PKCE を Tauri 向けの Rust コード（`crates/lita-auth`）で通し、得た ID トークンを Supabase に渡してセッションを得るまでを実機で確認した記録です。

## 結論

- **ループバック＋PKCE は動く。** `http://127.0.0.1:<ランダムポート>` で受け、Google の ID トークンを nonce 付きで検証できた。ブラウザ往復は同意済みなら 8.4 秒、初回同意込みで 32.6 秒【確度：高】
- **Google はデスクトップ用クライアントでも `client_secret` を要求する。** 省略すると `invalid_request: client_secret is missing`。調査時に【確度：低】としていた点が事実と確定【確度：高】
- **Supabase は nonce のハッシュ比較。** 生の nonce を両方に送ると `Nonces mismatch`。Google には SHA-256 の16進を nonce として渡し、Supabase には生の値を渡すと通る【確度：高】
- **Supabase の `grant_type=id_token` でセッションが取れ、リフレッシュもできる。** `auth.users` に本人の行ができた（有効期限 3600 秒）【確度：高】

## 手順

1. Google Cloud プロジェクト `lita-509404`（組織 muumoo.online）に同意画面（External / Testing、テストユーザー kuno@muumoo.online）と Desktop app クライアント「Lita desktop」を作成（ブラウザ操作エージェント）
2. Supabase プロジェクト `csfvqpqzvcorqlsmfjwb` の Google プロバイダを有効化（`supabase/config.toml` の `[auth.external.google]`、シークレットは `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)`。`supabase config push` で反映。Storage 設定の読み取りで CLI 版差のエラーが出るが認証設定は適用される）
3. `cargo run -p lita-auth --bin login` を、`LITA_GOOGLE_CLIENT_ID` / `LITA_GOOGLE_CLIENT_SECRET` / `LITA_SUPABASE_URL` / `LITA_SUPABASE_ANON_KEY` を環境変数にして実行。値はすべて macOS キーチェーン（account `lita`）にある

## 途中で踏んだ穴

- ループバック受信で `os error 35`（EAGAIN）。原因は2つ。非ブロッキングの accept を使っていたこと、そしてヘッダーの空行の先まで読もうとして読み取りタイムアウトが macOS では EAGAIN として返ること。ブロッキング accept を別スレッドに置き、空行で止めるように修正し、ユニットテスト3件を追加した
- 本人が古いタブで許可すると、古いポートに戻るので受け取れない。UI では「一番新しいタブで許可」と案内するか、古いフローを明示的に破棄する

## 方式の選択（D-41）

Google がシークレットを要求する以上、方式は2つ。**2026-09-22 に B を採用**した。A の実装は git 履歴（`feat/26-google-login` の途中コミット）に残る。

| 方式 | 内容 | 利点 | 難点 |
| --- | --- | --- | --- |
| A. アプリにシークレットを同梱 | Desktop app クライアントのまま。Google 公式は「インストール型アプリのシークレットは秘密として扱われない」と明記 | 実装済み。Google のトークンをアプリだけで扱える | 公開リポジトリにシークレットが載る。悪用されても「Lita を名乗る同意画面」が作れる程度だが、見た目が悪い |
| B. Supabase 経由の OAuth | Google 側は Web application クライアント（リダイレクト先は `https://<ref>.supabase.co/auth/v1/callback`）。シークレットは Supabase が保持。アプリは Supabase に対して PKCE を行い、`redirect_to` にループバックを指定（許可リストに `http://127.0.0.1:*` を登録） | シークレットがアプリに一切載らない。Supabase 標準の流れ | リダイレクトが1段増える。ループバック許可のワイルドカードが期待通りに動くか未確認 |
