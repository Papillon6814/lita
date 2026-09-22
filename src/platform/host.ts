// Every call into the native side goes through this module. Nothing else in
// src/ imports @tauri-apps/*, so a browser-hosted build later is one module
// swap rather than a rewrite.

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export type CodexStatus =
  | { status: "ready"; version: string }
  | { status: "not_logged_in"; version: string }
  | { status: "not_installed" }
  | { status: "error"; message: string };

export const host = {
  codexStatus: () => invoke<CodexStatus>("codex_status"),
  openExternal: (url: string) => openUrl(url),
};
