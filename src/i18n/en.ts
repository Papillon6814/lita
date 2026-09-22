export const en = {
  "app.tagline": "Your posts, in your voice.",
  "codex.checking": "Checking Codex…",
  "codex.ready": "Codex {version} is ready.",
  "codex.notLoggedIn": "Codex {version} is installed but not logged in.",
  "codex.notLoggedIn.hint": "Run this in a terminal, then check again:",
  "codex.notInstalled": "Codex CLI is not installed.",
  "codex.notInstalled.hint": "Lita drives the Codex CLI you already use, so it needs to be on your PATH.",
  "codex.error": "Could not check Codex.",
  "action.install": "Install Codex",
  "action.retry": "Check again",
  "privacy.note": "Lita never reads or stores your OpenAI credentials. It only starts the codex command.",
} as const;

export type MessageKey = keyof typeof en;
