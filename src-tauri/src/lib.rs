//! The Tauri shell. Everything the UI can ask the native side for is a
//! `#[tauri::command]` here; the actual work lives in the `lita-*` crates.

mod config;

use std::sync::Mutex;

use lita_auth::{Session, SessionStore, SupabaseAuth};
use lita_codex::{CodexCli, Preflight};
use lita_store::Store;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

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

/// Whether someone is signed in to Lita (not to Codex; that is separate).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SessionStatus {
    SignedOut,
    SignedIn { email: Option<String> },
}

impl From<Option<&Session>> for SessionStatus {
    fn from(s: Option<&Session>) -> Self {
        match s {
            Some(s) => SessionStatus::SignedIn { email: s.user.email.clone() },
            None => SessionStatus::SignedOut,
        }
    }
}

/// Everything the commands share. `session` is `None` when signed out.
pub struct AppState {
    auth: SupabaseAuth,
    #[allow(dead_code)] // used by the next commands (voices, briefs, drafts)
    store: Store,
    keychain: SessionStore,
    session: Mutex<Option<Session>>,
}

impl AppState {
    fn new() -> anyhow::Result<Self> {
        Ok(Self {
            auth: SupabaseAuth::new(config::SUPABASE_URL, config::SUPABASE_ANON_KEY)?,
            store: Store::new(config::SUPABASE_URL, config::SUPABASE_ANON_KEY)?,
            keychain: SessionStore::new(config::KEYCHAIN_SERVICE),
            session: Mutex::new(None),
        })
    }

    /// Loads the stored session and refreshes it, so a stale token never
    /// reaches the UI as "signed in". A refresh failure means signed out.
    fn restore(&self) {
        let restored = match self.keychain.load() {
            Ok(Some(stored)) => match self.auth.refresh(&stored.refresh_token) {
                Ok(fresh) => {
                    let _ = self.keychain.save(&fresh);
                    Some(fresh)
                }
                Err(e) => {
                    eprintln!("stored session could not be refreshed; signing out: {e:#}");
                    let _ = self.keychain.clear();
                    None
                }
            },
            Ok(None) => None,
            Err(e) => {
                eprintln!("keychain unavailable: {e:#}");
                None
            }
        };
        *self.session.lock().unwrap() = restored;
    }

    fn status(&self) -> SessionStatus {
        SessionStatus::from(self.session.lock().unwrap().as_ref())
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

#[tauri::command]
fn session_status(state: State<'_, AppState>) -> SessionStatus {
    state.status()
}

/// Opens the browser for Google sign-in and waits for it to come back.
/// Blocks for as long as the person takes, so it runs off the main thread.
#[tauri::command]
async fn sign_in(app: AppHandle) -> Result<SessionStatus, String> {
    let opener = app.clone();
    let session = tauri::async_runtime::spawn_blocking(move || {
        let state = opener.state::<AppState>();
        state.auth.sign_in_with_provider("google", |url| {
            opener.opener().open_url(url.as_str(), None::<&str>).map_err(Into::into)
        })
    })
    .await
    .map_err(|e| format!("sign-in task failed: {e}"))?
    .map_err(|e| format!("{e:#}"))?;

    let state = app.state::<AppState>();
    state.keychain.save(&session).map_err(|e| format!("{e:#}"))?;
    *state.session.lock().unwrap() = Some(session);
    Ok(state.status())
}

#[tauri::command]
fn sign_out(state: State<'_, AppState>) -> Result<SessionStatus, String> {
    state.keychain.clear().map_err(|e| format!("{e:#}"))?;
    *state.session.lock().unwrap() = None;
    Ok(state.status())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::new().expect("Supabase configuration is valid");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .setup(|app| {
            // Off the main thread: the refresh is a network round trip.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || handle.state::<AppState>().restore());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![codex_status, session_status, sign_in, sign_out])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
