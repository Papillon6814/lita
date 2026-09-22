//! The Tauri shell. Everything the UI can ask the native side for is a
//! `#[tauri::command]` here; the actual work lives in the `lita-*` crates.

mod config;

use std::sync::Mutex;

use lita_auth::{Session, SessionStore, SupabaseAuth};
use lita_codex::voice::VoiceProfile;
use lita_codex::{CodexCli, Effort, Preflight, Request};
use lita_sources::Piece;
use lita_store::{NewSource, SourceKind, Store, Voice, VoiceSummary};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
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

    /// The current access token, or a message the UI can show.
    fn access_token(&self) -> Result<String, String> {
        self.session
            .lock()
            .unwrap()
            .as_ref()
            .map(|s| s.access_token.clone())
            .ok_or_else(|| "not signed in".to_string())
    }
}

fn fail(e: anyhow::Error) -> String {
    format!("{e:#}")
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

// ----- voices ----------------------------------------------------------------

#[tauri::command]
async fn list_voices(app: AppHandle) -> Result<Vec<VoiceSummary>, String> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>().store.as_user(token).voices().map_err(fail)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_voice(app: AppHandle, id: String) -> Result<Option<Voice>, String> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>().store.as_user(token).voice(&id).map_err(fail)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_voice(app: AppHandle, id: String) -> Result<bool, String> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>().store.as_user(token).delete_voice(&id).map_err(fail)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// One piece of writing handed in by the UI.
#[derive(Debug, Deserialize)]
pub struct SourceInput {
    pub kind: SourceKind,
    pub origin: Option<String>,
    pub body: String,
}

/// Progress of a Voice build, for the stage display (D-26). Codex reports
/// only four coarse events, so these are milestones, not a percentage.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "stage", rename_all = "snake_case")]
pub enum VoiceProgress {
    Started,
    Thinking,
    Extracted,
    Saved,
}

/// Builds a Voice from the given writing: Codex extracts the profile
/// (45–65 s measured), then it is stored with its sources. Emits
/// `voice-progress` events along the way.
#[tauri::command]
async fn create_voice(app: AppHandle, name: String, sources: Vec<SourceInput>) -> Result<Voice, String> {
    let sources: Vec<NewSource> = sources
        .into_iter()
        .map(|s| NewSource { kind: s.kind, origin: s.origin, body: s.body.trim().to_string() })
        .filter(|s| !s.body.is_empty())
        .collect();
    if sources.is_empty() {
        return Err("paste at least one piece of writing".into());
    }
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("give the voice a name".into());
    }

    let token = app.state::<AppState>().access_token()?;
    let working_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn_blocking(move || -> Result<Voice, String> {
        std::fs::create_dir_all(&working_dir).map_err(|e| e.to_string())?;
        let _ = app.emit("voice-progress", VoiceProgress::Started);

        let samples: Vec<&str> = sources.iter().map(|s| s.body.as_str()).collect();
        let req = Request {
            prompt: VoiceProfile::extraction_prompt(&samples),
            schema: VoiceProfile::extraction_schema(),
            model: None,
            effort: Effort::Quality,
            working_dir,
        };
        let emitter = app.clone();
        let run = CodexCli::on_path()
            .run_typed::<VoiceProfile>(&req, |event| {
                if event.kind == "turn.started" {
                    let _ = emitter.emit("voice-progress", VoiceProgress::Thinking);
                }
            })
            .map_err(fail)?;
        let _ = app.emit("voice-progress", VoiceProgress::Extracted);

        let voice = app
            .state::<AppState>()
            .store
            .as_user(token)
            .create_voice(&name, &run.value, &sources)
            .map_err(fail)?;
        let _ = app.emit("voice-progress", VoiceProgress::Saved);
        Ok(voice)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ----- sources (D-43) ---------------------------------------------------------

/// What an import found, beyond the pieces themselves.
#[derive(Debug, Serialize)]
pub struct Imported {
    pub pieces: Vec<Piece>,
    /// Everything the account has published, when the source reports it.
    pub total: Option<u64>,
    /// Paid articles that were left out.
    pub skipped_paid: usize,
    /// Whether the source only exposes its most recent items.
    pub recent_only: bool,
}

/// Up to twenty: D-20 measured that a Voice is stable from four pieces and
/// twenty mostly adds vocabulary.
const IMPORT_MAX: usize = 20;

#[tauri::command]
async fn import_note(account: String) -> Result<Imported, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (listing, pieces) = lita_sources::note::import(&account, IMPORT_MAX).map_err(fail)?;
        Ok(Imported { pieces, total: Some(listing.total_count), skipped_paid: listing.skipped_paid, recent_only: false })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn import_medium(handle: String) -> Result<Imported, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pieces = lita_sources::medium::import(&handle).map_err(fail)?;
        Ok(Imported { pieces, total: None, skipped_paid: 0, recent_only: true })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `contents` is the text of `data/tweets.js` from the archive, read by
/// the UI. Newest posts first, capped like the other imports.
#[tauri::command]
async fn import_x_archive(contents: String, handle: Option<String>, include_replies: bool) -> Result<Imported, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let opts = lita_sources::x::Options { include_replies, ..Default::default() };
        let mut pieces = lita_sources::x::parse_tweets_js(&contents, handle.as_deref(), opts).map_err(fail)?;
        let total = pieces.len() as u64;
        pieces.truncate(IMPORT_MAX);
        Ok(Imported { pieces, total: Some(total), skipped_paid: 0, recent_only: false })
    })
    .await
    .map_err(|e| e.to_string())?
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
        .invoke_handler(tauri::generate_handler![
            codex_status,
            session_status,
            sign_in,
            sign_out,
            list_voices,
            get_voice,
            delete_voice,
            create_voice,
            import_note,
            import_medium,
            import_x_archive
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
