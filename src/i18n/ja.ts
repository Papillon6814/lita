import type { MessageKey } from "./en";

export const ja: Record<MessageKey, string> = {
  "app.tagline": "あなたの文体で、あなたの投稿を。",
  "codex.checking": "Codex を確認しています…",
  "codex.ready": "Codex {version} を使えます。",
  "codex.notLoggedIn": "Codex {version} はインストール済みですが、ログインしていません。",
  "codex.notLoggedIn.hint": "ターミナルで次を実行してから、もう一度確認してください。",
  "codex.notInstalled": "Codex CLI がインストールされていません。",
  "codex.notInstalled.hint": "Lita は手元の Codex CLI を起動して使うため、PATH に必要です。",
  "codex.error": "Codex の状態を確認できませんでした。",
  "action.install": "Codex をインストール",
  "action.retry": "もう一度確認",
  "session.checking": "セッションを確認しています…",
  "session.signedOut": "サインインすると、Voice と下書きをどの PC からでも使えます。",
  "session.signedIn": "{email} としてサインイン中。",
  "session.waiting": "ブラウザで Google のサインインを完了してください…",
  "session.error": "サインインが完了しませんでした。",
  "action.signIn": "Google でサインイン",
  "action.signOut": "サインアウト",
  "privacy.note": "Lita は OpenAI の認証情報を読んだり保存したりしません。codex コマンドを起動するだけです。",
};
