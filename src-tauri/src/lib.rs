//! The Tauri shell. Everything the UI can ask the native side for is a
//! `#[tauri::command]` here; the actual work lives in the `lita-*` crates.

use lita_codex::{CodexCli, Preflight};
use serde::Serialize;

/// What the UI needs to know about Codex before anything else can happen.
/// Each variant maps to a different next step for the user, which is why
/// they stay distinct instead of collapsing into ok/error.
#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CodexStatus {
    Ready { version: String },
    NotLoggedIn { version: String },
    NotInstalled,
    Error { message: String },
}

impl From<Preflight> for CodexStatus {
    fn from(p: Preflight) -> Self {
        match p {
            Preflight::Ready { version } => CodexStatus::Ready { version },
            Preflight::NotLoggedIn { version } => CodexStatus::NotLoggedIn { version },
            Preflight::NotInstalled => CodexStatus::NotInstalled,
        }
    }
}

/// Runs `codex doctor --json` off the main thread, because it takes about a
/// second and the window must not freeze while it does.
#[tauri::command]
async fn codex_status() -> CodexStatus {
    let result = tauri::async_runtime::spawn_blocking(|| CodexCli::on_path().preflight()).await;
    match result {
        Ok(Ok(preflight)) => preflight.into(),
        Ok(Err(e)) => CodexStatus::Error { message: format!("{e:#}") },
        Err(e) => CodexStatus::Error { message: format!("preflight task failed: {e}") },
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![codex_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
