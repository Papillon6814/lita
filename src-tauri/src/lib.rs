//! The Tauri shell. Everything the UI can ask the native side for is a
//! `#[tauri::command]` here; the actual work lives in the `lita-*` crates.

mod config;
mod errors;

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use errors::UiError;

use lita_auth::{Session, SessionStore, SupabaseAuth};
use lita_codex::post::{PlatformRules, PostDraft, generation_prompt, post_schema};
use lita_codex::topics::{self, Existing, Lang, Policy, Topics};
use lita_codex::voice::{VoiceProfile, pipeline};
use lita_codex::{CodexCli, Preflight, Request};
use lita_sources::Piece;
use lita_store::{Article, ArticlePatch, ArticleStatus, ArticleSummary, ArticleVersion, NewArticle, NewSource, NewVersion, Platform, QueueState, SourceKind, Store, StoredEffort, VersionKind, Voice, VoiceSummary};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri_plugin_updater::UpdaterExt;
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
    ConfigBroken { version: String, message: String },
    Error { message: String },
}

impl From<Preflight> for CodexStatus {
    fn from(p: Preflight) -> Self {
        match p {
            Preflight::Ready { version } => CodexStatus::Ready { version },
            Preflight::NotLoggedIn { version } => CodexStatus::NotLoggedIn { version },
            Preflight::NotInstalled => CodexStatus::NotInstalled,
            Preflight::ConfigBroken { version, detail } => CodexStatus::ConfigBroken { version, message: detail },
        }
    }
}

/// Whether someone is signed in to Lita (not to Codex; that is separate).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SessionStatus {
    /// The stored session is still being refreshed; ask again shortly.
    Restoring,
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
    /// True until the launch-time restore has finished.
    restoring: AtomicBool,
    /// Set by `cancel_sign_in`; cleared when a sign-in starts.
    sign_in_cancel: Arc<AtomicBool>,
    /// Set by `cancel_voice_build`; cleared when a build starts.
    build_cancel: Arc<AtomicBool>,
    /// Set by `cancel_generate`; cleared when a generation starts.
    generate_cancel: Arc<AtomicBool>,
    /// True while the article queue's worker is running (one at a time).
    queue_running: AtomicBool,
    /// The effort the queue writes with: what the editor was set to when
    /// the articles were queued (requirement 13).
    queue_effort: Mutex<StoredEffort>,
}

impl AppState {
    fn new() -> anyhow::Result<Self> {
        Ok(Self {
            auth: SupabaseAuth::new(config::SUPABASE_URL, config::SUPABASE_ANON_KEY)?,
            store: Store::new(config::SUPABASE_URL, config::SUPABASE_ANON_KEY)?,
            keychain: SessionStore::new(config::KEYCHAIN_SERVICE),
            session: Mutex::new(None),
            restoring: AtomicBool::new(true),
            sign_in_cancel: Arc::new(AtomicBool::new(false)),
            build_cancel: Arc::new(AtomicBool::new(false)),
            generate_cancel: Arc::new(AtomicBool::new(false)),
            queue_running: AtomicBool::new(false),
            queue_effort: Mutex::new(StoredEffort::Quality),
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
        self.restoring.store(false, Ordering::Release);
    }

    fn status(&self) -> SessionStatus {
        if self.restoring.load(Ordering::Acquire) {
            return SessionStatus::Restoring;
        }
        SessionStatus::from(self.session.lock().unwrap().as_ref())
    }

    /// The current access token, or the error the UI shows when signed out.
    fn access_token(&self) -> Result<String, UiError> {
        self.session
            .lock()
            .unwrap()
            .as_ref()
            .map(|s| s.access_token.clone())
            .ok_or_else(UiError::not_signed_in)
    }
}

fn fail(e: anyhow::Error) -> UiError {
    UiError::from(e)
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
async fn sign_in(app: AppHandle) -> Result<SessionStatus, UiError> {
    let cancel = {
        let state = app.state::<AppState>();
        state.sign_in_cancel.store(false, Ordering::Relaxed);
        Arc::clone(&state.sign_in_cancel)
    };
    let opener = app.clone();
    let session = tauri::async_runtime::spawn_blocking(move || {
        let state = opener.state::<AppState>();
        state.auth.sign_in_with_provider_cancellable(
            "google",
            |url| opener.opener().open_url(url.as_str(), None::<&str>).map_err(Into::into),
            &cancel,
        )
    })
    .await
    .map_err(|e| UiError::unknown(format!("sign-in task failed: {e}")))?
    .map_err(fail)?;

    let state = app.state::<AppState>();
    state.keychain.save(&session).map_err(fail)?;
    *state.session.lock().unwrap() = Some(session);
    Ok(state.status())
}

#[tauri::command]
fn cancel_sign_in(state: State<'_, AppState>) {
    state.sign_in_cancel.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn sign_out(state: State<'_, AppState>) -> Result<SessionStatus, UiError> {
    state.keychain.clear().map_err(fail)?;
    *state.session.lock().unwrap() = None;
    Ok(state.status())
}

// ----- voices ----------------------------------------------------------------

#[tauri::command]
async fn list_voices(app: AppHandle) -> Result<Vec<VoiceSummary>, UiError> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>().store.as_user(token).voices().map_err(fail)
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

#[tauri::command]
async fn get_voice(app: AppHandle, id: String) -> Result<Option<Voice>, UiError> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>().store.as_user(token).voice(&id).map_err(fail)
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

#[tauri::command]
async fn delete_voice(app: AppHandle, id: String) -> Result<bool, UiError> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>().store.as_user(token).delete_voice(&id).map_err(fail)
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

#[tauri::command]
async fn rename_voice(app: AppHandle, id: String, name: String) -> Result<(), UiError> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(UiError::invalid("give the voice a name"));
    }
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>().store.as_user(token).rename_voice(&id, &name).map_err(fail)
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

/// The person corrected part of the profile. Stored as given; the UI owns
/// the editing rules.
#[tauri::command]
async fn update_voice_profile(app: AppHandle, id: String, profile: VoiceProfile) -> Result<Option<Voice>, UiError> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || {
        let me = app.state::<AppState>();
        let store = me.store.as_user(token);
        store.update_profile(&id, &profile).map_err(fail)?;
        store.voice(&id).map_err(fail)
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

/// One piece of writing handed in by the UI.
#[derive(Debug, Deserialize)]
pub struct SourceInput {
    pub kind: SourceKind,
    pub origin: Option<String>,
    #[serde(default)]
    pub account: Option<String>,
    pub body: String,
}

fn to_sources(sources: Vec<SourceInput>) -> Vec<NewSource> {
    sources
        .into_iter()
        .map(|s| NewSource { kind: s.kind, origin: s.origin, account: s.account, body: s.body.trim().to_string() })
        .filter(|s| !s.body.is_empty())
        .collect()
}

/// Reads a voice profile out of `sources` with the careful four-stage
/// pipeline (measure → read each piece → synthesise → check), reporting
/// the real stages on `voice-progress`. Shared by the first build and by
/// relearning (#68). Falls back to the single call inside the pipeline.
fn extract_profile(app: &AppHandle, sources: &[NewSource], cancel: Arc<AtomicBool>, working_dir: std::path::PathBuf) -> Result<VoiceProfile, UiError> {
    std::fs::create_dir_all(&working_dir).map_err(|e| UiError::unknown(e.to_string()))?;
    let bodies: Vec<&str> = sources.iter().map(|s| s.body.as_str()).collect();
    let emitter = app.clone();
    let outcome = pipeline::extract(&CodexCli::on_path(), &bodies, &pipeline::Config::default(), working_dir, cancel, |stage| {
        let p = match stage {
            pipeline::Stage::Measuring => VoiceProgress::Started,
            pipeline::Stage::Reading { done, total } => VoiceProgress::Reading { done, total },
            pipeline::Stage::Synthesising => VoiceProgress::Thinking,
            pipeline::Stage::Checking => VoiceProgress::Checking,
            pipeline::Stage::Done => VoiceProgress::Extracted,
        };
        let _ = emitter.emit("voice-progress", p);
    })
    .map_err(fail)?;
    if outcome.report.fell_back {
        eprintln!("voice extraction fell back to the single call: {:?}", outcome.report.notes);
    }
    Ok(outcome.profile)
}

/// Progress of a Voice build, for the stage display. Since 2026-09-23 the
/// stages are real (voice quality requirement, must 17): measuring, reading
/// piece n of m, synthesising, checking, done, saved.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "stage", rename_all = "snake_case")]
pub enum VoiceProgress {
    Started,
    Reading { done: usize, total: usize },
    Thinking,
    Checking,
    Extracted,
    Saved,
}

/// The limits `create_voice` applies, so the UI can show them.
#[derive(Debug, Serialize)]
pub struct MaterialBudget {
    pub per_piece_chars: usize,
    pub total_chars: usize,
}

#[tauri::command]
fn material_budget() -> MaterialBudget {
    let c = pipeline::Config::default();
    MaterialBudget { per_piece_chars: c.head_chars + c.tail_chars, total_chars: c.total_chars }
}

/// Builds a Voice from the given writing: the four-stage pipeline reads the
/// profile (a few minutes), then it is stored with its sources. Emits
/// `voice-progress` events along the way. Material is capped by
/// `pipeline::Config::default()`; the sources are stored in full regardless.
#[tauri::command]
async fn create_voice(app: AppHandle, name: String, sources: Vec<SourceInput>) -> Result<Voice, UiError> {
    let sources = to_sources(sources);
    if sources.is_empty() {
        return Err(UiError::invalid("paste at least one piece of writing"));
    }
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(UiError::invalid("give the voice a name"));
    }
    let (token, cancel) = {
        let state = app.state::<AppState>();
        state.build_cancel.store(false, Ordering::Relaxed);
        (state.access_token()?, Arc::clone(&state.build_cancel))
    };
    let working_dir = app.path().app_data_dir().map_err(|e| UiError::unknown(e.to_string()))?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Voice, UiError> {
        let profile = extract_profile(&app, &sources, cancel, working_dir)?;
        let voice = app.state::<AppState>().store.as_user(token).create_voice(&name, &profile, &sources).map_err(fail)?;
        let _ = app.emit("voice-progress", VoiceProgress::Saved);
        Ok(voice)
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

/// Adds writing to a voice (#68): a new connection or new articles from one.
/// The profile stays; relearning is `rebuild_voice`.
#[tauri::command]
async fn add_voice_sources(app: AppHandle, voice_id: String, sources: Vec<SourceInput>) -> Result<Option<Voice>, UiError> {
    let sources = to_sources(sources);
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let store = state.store.as_user(token);
        store.add_sources(&voice_id, &sources).map_err(fail)?;
        store.voice(&voice_id).map_err(fail)
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

/// Drops one connection (every piece of `kind` from `account`).
#[tauri::command]
async fn remove_voice_sources(app: AppHandle, voice_id: String, kind: SourceKind, account: Option<String>) -> Result<Option<Voice>, UiError> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let store = state.store.as_user(token);
        store.delete_sources(&voice_id, kind, account.as_deref()).map_err(fail)?;
        store.voice(&voice_id).map_err(fail)
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

/// Drops a single piece (manual intake: one pasted post or one file).
#[tauri::command]
async fn remove_voice_source(app: AppHandle, voice_id: String, source_id: String) -> Result<Option<Voice>, UiError> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let store = state.store.as_user(token);
        store.delete_source(&voice_id, &source_id).map_err(fail)?;
        store.voice(&voice_id).map_err(fail)
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

/// Reads the profile again from everything the voice now has. Hand edits
/// to the details are overwritten; the UI says so before calling this.
#[tauri::command]
async fn rebuild_voice(app: AppHandle, voice_id: String) -> Result<Voice, UiError> {
    let (token, cancel) = {
        let state = app.state::<AppState>();
        state.build_cancel.store(false, Ordering::Relaxed);
        (state.access_token()?, Arc::clone(&state.build_cancel))
    };
    let working_dir = app.path().app_data_dir().map_err(|e| UiError::unknown(e.to_string()))?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Voice, UiError> {
        let state = app.state::<AppState>();
        let store = state.store.as_user(token);
        let voice = store.voice(&voice_id).map_err(fail)?.ok_or_else(|| UiError::invalid("no such voice"))?;
        let sources: Vec<NewSource> = voice
            .sources
            .iter()
            .map(|s| NewSource { kind: s.kind, origin: s.origin.clone(), account: s.account.clone(), body: s.body.clone() })
            .collect();
        if sources.is_empty() {
            return Err(UiError::invalid("this voice has no writing to learn from"));
        }
        let profile = extract_profile(&app, &sources, cancel, working_dir)?;
        store.update_profile(&voice_id, &profile).map_err(fail)?;
        let _ = app.emit("voice-progress", VoiceProgress::Saved);
        store.voice(&voice_id).map_err(fail)?.ok_or_else(|| UiError::invalid("voice vanished"))
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

#[tauri::command]
fn cancel_voice_build(state: State<'_, AppState>) {
    state.build_cancel.store(true, Ordering::Relaxed);
}

// ----- writing (B-07, B-08, B-13) ------------------------------------------

#[tauri::command]
async fn platforms(app: AppHandle) -> Result<Vec<Platform>, UiError> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>().store.as_user(token).platforms().map_err(fail)
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

fn rules_of(p: &Platform) -> PlatformRules {
    PlatformRules { name: p.name.clone(), max_chars: p.max_chars, rules: p.rules.clone() }
}

/// The exact text that `generate_draft` would send (B-08).
#[tauri::command]
async fn preview_prompt(app: AppHandle, voice_id: String, brief: String, platform_id: String, previous: Option<String>) -> Result<String, UiError> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let store = state.store.as_user(token);
        let voice = store.voice(&voice_id).map_err(fail)?.ok_or_else(|| UiError::invalid("no such voice"))?;
        let platform = store
            .platforms()
            .map_err(fail)?
            .into_iter()
            .find(|p| p.id == platform_id)
            .ok_or_else(|| UiError::invalid("no such platform"))?;
        Ok(prompt_for(&voice.profile, &brief, &rules_of(&platform), previous.as_deref()))
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

/// What the write screen gets back from a generation. `draft` mirrors the
/// v0.1 shape (id = the article's id) so the current UI keeps working until
/// the editor replaces it (v0.2 phase 2).
#[derive(Debug, Serialize)]
pub struct Generated {
    pub draft: DraftView,
    pub voice_notes: String,
}

#[derive(Debug, Serialize)]
pub struct DraftView {
    pub id: String,
    pub brief_id: String,
    pub body: String,
    pub prompt_sent: String,
    pub model: Option<String>,
    pub elapsed_ms: i64,
    pub status: &'static str,
    pub created_at: String,
    pub decided_at: Option<String>,
}

/// One place decides between a fresh draft and a shorter rewrite (#40), so
/// the preview and the run can never disagree.
fn prompt_for(profile: &lita_codex::voice::VoiceProfile, brief: &str, rules: &lita_codex::post::PlatformRules, previous: Option<&str>) -> String {
    match previous.map(str::trim).filter(|p| !p.is_empty()) {
        Some(prev) => lita_codex::post::shorten_prompt(profile, brief, rules, prev),
        None => generation_prompt(profile, brief, rules),
    }
}

/// Runs Codex for one article and records the result as a version and as
/// the article's current text. Shared by the v0.1 write screen and the
/// editor. Measured 6.6 s (Fast) / 10.8 s (Quality) for a short X post (D-24).
fn write_article(
    app: &AppHandle,
    token: String,
    cancel: Arc<AtomicBool>,
    working_dir: std::path::PathBuf,
    article_id: &str,
    effort: StoredEffort,
    previous: Option<String>,
) -> Result<(Article, ArticleVersion, String), UiError> {
    std::fs::create_dir_all(&working_dir).map_err(|e| UiError::unknown(e.to_string()))?;
    let state = app.state::<AppState>();
    let store = state.store.as_user(token);
    let article = store.article(article_id).map_err(fail)?.ok_or_else(|| UiError::invalid("no such article"))?;
    if article.brief.trim().is_empty() {
        return Err(UiError::invalid("write a brief first"));
    }
    let voice_id = article.voice_id.clone().ok_or_else(|| UiError::invalid("pick a voice first"))?;
    let voice = store.voice(&voice_id).map_err(fail)?.ok_or_else(|| UiError::invalid("no such voice"))?;
    let platform = store
        .platforms()
        .map_err(fail)?
        .into_iter()
        .find(|p| p.id == article.platform_id)
        .ok_or_else(|| UiError::invalid("no such platform"))?;

    let prompt = prompt_for(&voice.profile, &article.brief, &rules_of(&platform), previous.as_deref());
    let req = Request { prompt: prompt.clone(), schema: post_schema(), model: None, effort: effort.into(), working_dir };
    let run = CodexCli::on_path()
        .run_typed_cancellable::<PostDraft>(&req, |_| {}, cancel)
        .map_err(fail)?;

    let body = run.value.text.trim().to_string();
    let title = if run.value.title.trim().is_empty() { article.title.clone() } else { run.value.title.trim().to_string() };
    let version = store
        .create_version(&NewVersion {
            article_id: article.id.clone(),
            kind: if previous.is_some() { VersionKind::Shortened } else { VersionKind::Generated },
            title: title.clone(),
            body: body.clone(),
            prompt_sent: Some(prompt),
            elapsed_ms: Some(run.elapsed.as_millis() as i64),
        })
        .map_err(fail)?;
    store
        .update_article(&article.id, &ArticlePatch { body: Some(body), title: Some(title), ..Default::default() })
        .map_err(fail)?;
    let article = store.article(&article.id).map_err(fail)?.ok_or_else(|| UiError::invalid("article vanished"))?;
    Ok((article, version, run.value.voice_notes))
}

/// v0.1 write screen: brief → a new article → Codex → its first version.
/// `previous` (the over-long text) asks for a shorter rewrite of the same
/// article instead of a new one; the article is found by `article_id`.
#[tauri::command]
async fn generate_draft(
    app: AppHandle,
    voice_id: String,
    brief: String,
    platform_id: String,
    effort: StoredEffort,
    previous: Option<String>,
    article_id: Option<String>,
) -> Result<Generated, UiError> {
    let brief = brief.trim().to_string();
    if brief.is_empty() {
        return Err(UiError::invalid("write a brief first"));
    }
    let (token, cancel) = {
        let state = app.state::<AppState>();
        state.generate_cancel.store(false, Ordering::Relaxed);
        (state.access_token()?, Arc::clone(&state.generate_cancel))
    };
    let working_dir = app.path().app_data_dir().map_err(|e| UiError::unknown(e.to_string()))?;

    tauri::async_runtime::spawn_blocking(move || -> Result<Generated, UiError> {
        let id = {
            let state = app.state::<AppState>();
            let store = state.store.as_user(token.clone());
            match article_id {
                Some(id) => {
                    store.update_article(&id, &ArticlePatch { brief: Some(brief.clone()), ..Default::default() }).map_err(fail)?;
                    id
                }
                None => store
                    .create_article(&NewArticle { voice_id: Some(voice_id.clone()), platform_id: platform_id.clone(), brief: brief.clone(), ..Default::default() })
                    .map_err(fail)?
                    .id,
            }
        };
        let (article, version, voice_notes) = write_article(&app, token, cancel, working_dir, &id, effort, previous)?;
        Ok(Generated {
            draft: DraftView {
                id: article.id,
                brief_id: id,
                body: article.body,
                prompt_sent: version.prompt_sent.unwrap_or_default(),
                model: None,
                elapsed_ms: version.elapsed_ms.unwrap_or(0),
                status: "pending",
                created_at: version.created_at,
                decided_at: None,
            },
            voice_notes,
        })
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

/// Editor: (re)write an article's text from its brief, or shorten `previous`.
#[tauri::command]
async fn generate_into_article(app: AppHandle, article_id: String, effort: StoredEffort, previous: Option<String>) -> Result<ArticleWritten, UiError> {
    let (token, cancel) = {
        let state = app.state::<AppState>();
        state.generate_cancel.store(false, Ordering::Relaxed);
        (state.access_token()?, Arc::clone(&state.generate_cancel))
    };
    let working_dir = app.path().app_data_dir().map_err(|e| UiError::unknown(e.to_string()))?;
    tauri::async_runtime::spawn_blocking(move || {
        let (article, version, voice_notes) = write_article(&app, token, cancel, working_dir, &article_id, effort, previous)?;
        Ok(ArticleWritten { article, version, voice_notes })
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

#[derive(Debug, Serialize)]
pub struct ArticleWritten {
    pub article: Article,
    pub version: ArticleVersion,
    pub voice_notes: String,
}

#[tauri::command]
fn cancel_generate(state: State<'_, AppState>) {
    state.generate_cancel.store(true, Ordering::Relaxed);
}

/// v0.1 compat: the write screen's decision, applied to the article.
#[tauri::command]
async fn set_draft_status(app: AppHandle, id: String, status: String) -> Result<(), UiError> {
    let status = match status.as_str() {
        "approved" => ArticleStatus::Approved,
        "discarded" => ArticleStatus::Archived,
        _ => ArticleStatus::Draft,
    };
    update_article(app, id, ArticlePatch { status: Some(status), ..Default::default() }).await
}

// ----- article queue (requirements 2026-09-23-article-queue) ---------------

/// What the UI hears about the queue. `Changed` says "list again";
/// `Stopped` carries the one failure that would hit every article.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum QueueEvent {
    Changed,
    Stopped { error: UiError },
}

fn emit_queue(app: &AppHandle, e: QueueEvent) {
    let _ = app.emit("queue-event", e);
}

/// Failures that are about the person's setup, not about one article: the
/// queue stops on them instead of marking every article failed in turn.
fn stops_the_queue(code: &str) -> bool {
    matches!(
        code,
        "codex_not_logged_in" | "codex_not_installed" | "codex_config_broken" | "codex_quota" | "not_signed_in" | "session_expired" | "network"
    )
}

/// The material title suggestions and the policy draft are read from: the
/// head of every voice's sources, and what has already been written.
fn topic_material(store: &lita_store::UserStore<'_>) -> Result<(Vec<String>, Vec<Existing>, Lang), UiError> {
    let mut samples = Vec::new();
    let mut lang = Lang::Ja;
    for v in store.voices().map_err(fail)? {
        if let Some(voice) = store.voice(&v.id).map_err(fail)? {
            lang = Lang::of(&voice.profile.language);
            samples.extend(voice.sources.into_iter().map(|s| s.body));
        }
    }
    let existing = store
        .articles(None)
        .map_err(fail)?
        .into_iter()
        .take(50)
        .map(|a| Existing { title: a.title, first_line: a.excerpt })
        .collect();
    Ok((samples, existing, lang))
}

#[tauri::command]
async fn get_policy(app: AppHandle) -> Result<Policy, UiError> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().store.as_user(token).settings().map(|s| s.policy).map_err(fail))
        .await
        .map_err(|e| UiError::unknown(e.to_string()))?
}

#[tauri::command]
async fn set_policy(app: AppHandle, policy: Policy) -> Result<(), UiError> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().store.as_user(token).set_policy(&policy).map_err(fail))
        .await
        .map_err(|e| UiError::unknown(e.to_string()))?
}

/// Codex drafts the four fields from the person's writing. Not saved: the
/// person edits it on screen and saves with `set_policy`.
#[tauri::command]
async fn draft_policy(app: AppHandle) -> Result<Policy, UiError> {
    let token = app.state::<AppState>().access_token()?;
    let working_dir = app.path().app_data_dir().map_err(|e| UiError::unknown(e.to_string()))?;
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&working_dir).map_err(|e| UiError::unknown(e.to_string()))?;
        let state = app.state::<AppState>();
        let store = state.store.as_user(token);
        let (samples, existing, lang) = topic_material(&store)?;
        if samples.is_empty() && existing.is_empty() {
            return Err(UiError::invalid("nothing to read yet"));
        }
        let refs: Vec<&str> = samples.iter().map(String::as_str).collect();
        let req = Request { prompt: topics::policy_prompt(&refs, &existing, lang), schema: topics::policy_schema(), model: None, effort: lita_codex::Effort::Quality, working_dir };
        let run = CodexCli::on_path().run_typed::<Policy>(&req, |_| {}).map_err(fail)?;
        let mut policy = run.value;
        policy.topics.truncate(3);
        Ok(policy)
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

/// Ten titles the person could write next, none already written.
#[tauri::command]
async fn suggest_topics(app: AppHandle, direction: String) -> Result<Vec<String>, UiError> {
    const N: usize = 10;
    let token = app.state::<AppState>().access_token()?;
    let working_dir = app.path().app_data_dir().map_err(|e| UiError::unknown(e.to_string()))?;
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&working_dir).map_err(|e| UiError::unknown(e.to_string()))?;
        let state = app.state::<AppState>();
        let store = state.store.as_user(token);
        let policy = store.settings().map_err(fail)?.policy;
        let (samples, existing, lang) = topic_material(&store)?;
        let refs: Vec<&str> = samples.iter().map(String::as_str).collect();
        // Ask for a few more than shown, so dropping repeats still leaves ten.
        let req = Request { prompt: topics::topics_prompt(&policy, &refs, &existing, &direction, N + 4, lang), schema: topics::topics_schema(), model: None, effort: lita_codex::Effort::Quality, working_dir };
        let run = CodexCli::on_path().run_typed::<Topics>(&req, |_| {}).map_err(fail)?;
        Ok(topics::dedupe(run.value.topics, &existing, N))
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

/// One draft per title, brief filled from the policy, queued in the order
/// given. Starts the worker. Returns the new rows as the list shows them.
#[tauri::command]
async fn enqueue_articles(app: AppHandle, titles: Vec<String>, voice_id: String, platform_id: String, effort: StoredEffort, direction: String) -> Result<Vec<ArticleSummary>, UiError> {
    let titles: Vec<String> = titles.into_iter().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect();
    if titles.is_empty() || titles.len() > 5 {
        return Err(UiError::invalid("pick one to five titles"));
    }
    let token = app.state::<AppState>().access_token()?;
    let created = {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<Vec<ArticleSummary>, UiError> {
            let state = app.state::<AppState>();
            *state.queue_effort.lock().unwrap() = effort;
            let store = state.store.as_user(token);
            let policy = store.settings().map_err(fail)?.policy;
            let lang = store.voice(&voice_id).map_err(fail)?.map(|v| Lang::of(&v.profile.language)).unwrap_or(Lang::Ja);
            let mut out = Vec::new();
            for title in titles {
                let a = store
                    .create_article(&NewArticle {
                        voice_id: Some(voice_id.clone()),
                        platform_id: platform_id.clone(),
                        title: title.clone(),
                        brief: topics::brief_for(&title, &policy, &direction, lang),
                        queue: Some(QueueState::Waiting),
                        ..Default::default()
                    })
                    .map_err(fail)?;
                out.push(ArticleSummary { id: a.id, voice_id: a.voice_id, platform_id: a.platform_id, title: a.title, excerpt: String::new(), status: a.status, queue: a.queue, created_at: a.created_at, updated_at: a.updated_at });
            }
            Ok(out)
        })
        .await
        .map_err(|e| UiError::unknown(e.to_string()))??
    };
    emit_queue(&app, QueueEvent::Changed);
    start_queue(app);
    Ok(created)
}

/// Runs the queue until nothing is waiting: one article at a time, oldest
/// first. Safe to call any time; a second call while running does nothing.
/// An article left "writing" by a closed app goes back to waiting first.
#[tauri::command]
fn start_queue(app: AppHandle) {
    let state = app.state::<AppState>();
    if state.queue_running.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let outcome = run_queue(&app);
        app.state::<AppState>().queue_running.store(false, Ordering::SeqCst);
        if let Err(error) = outcome {
            emit_queue(&app, QueueEvent::Stopped { error });
        }
    });
}

fn run_queue(app: &AppHandle) -> Result<(), UiError> {
    let state = app.state::<AppState>();
    let working_dir = app.path().app_data_dir().map_err(|e| UiError::unknown(e.to_string()))?;
    let mut first = true;
    loop {
        let token = state.access_token()?;
        let store = state.store.as_user(token.clone());
        let queued = store.queued().map_err(fail)?;
        if first {
            first = false;
            for a in queued.iter().filter(|a| a.queue == Some(QueueState::Writing)) {
                store.update_article(&a.id, &ArticlePatch { queue: Some(Some(QueueState::Waiting)), ..Default::default() }).map_err(fail)?;
            }
        }
        let Some(next) = queued.into_iter().find(|a| a.queue != Some(QueueState::Failed)) else {
            return Ok(());
        };
        // Codex problems hit every article alike: say so once and stop.
        match CodexCli::on_path().preflight().map_err(fail)? {
            Preflight::Ready { .. } => {}
            Preflight::NotInstalled => return Err(UiError { code: "codex_not_installed", detail: String::new() }),
            Preflight::NotLoggedIn { .. } => return Err(UiError { code: "codex_not_logged_in", detail: String::new() }),
            Preflight::ConfigBroken { detail, .. } => return Err(UiError { code: "codex_config_broken", detail }),
        }
        // Removed (やめる) between the listing and here: move on.
        if store.update_article(&next.id, &ArticlePatch { queue: Some(Some(QueueState::Writing)), ..Default::default() }).is_err() {
            continue;
        }
        emit_queue(app, QueueEvent::Changed);

        state.generate_cancel.store(false, Ordering::Relaxed);
        let cancel = Arc::clone(&state.generate_cancel);
        let effort = *state.queue_effort.lock().unwrap();
        let result = write_article(app, token, cancel, working_dir.clone(), &next.id, effort, None);
        let mark = match &result {
            Ok(_) => None,
            // Stopped by the person: an empty draft stays, unmarked.
            Err(e) if e.code == "cancelled" => None,
            Err(e) if stops_the_queue(e.code) => Some(QueueState::Waiting),
            Err(_) => Some(QueueState::Failed),
        };
        // The article may have been removed while it was being written.
        let _ = store.update_article(&next.id, &ArticlePatch { queue: Some(mark), ..Default::default() });
        emit_queue(app, QueueEvent::Changed);
        if let Err(e) = result {
            if stops_the_queue(e.code) {
                return Err(e);
            }
        }
    }
}

/// Waiting: the article is deleted (its body is empty; nothing is lost).
/// Writing: stopped; the empty draft stays. Failed: deleted.
#[tauri::command]
async fn dequeue_article(app: AppHandle, id: String) -> Result<(), UiError> {
    let token = app.state::<AppState>().access_token()?;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), UiError> {
        let state = app2.state::<AppState>();
        let store = state.store.as_user(token);
        let article = store.article(&id).map_err(fail)?.ok_or_else(|| UiError::invalid("no such article"))?;
        match article.queue {
            Some(QueueState::Writing) => state.generate_cancel.store(true, Ordering::Relaxed),
            Some(_) => {
                store.delete_article(&id).map_err(fail)?;
            }
            None => {}
        }
        Ok(())
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))??;
    emit_queue(&app, QueueEvent::Changed);
    Ok(())
}

/// Everything waiting is deleted and the one being written is stopped.
#[tauri::command]
async fn clear_queue(app: AppHandle) -> Result<(), UiError> {
    let token = app.state::<AppState>().access_token()?;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), UiError> {
        let state = app2.state::<AppState>();
        let store = state.store.as_user(token);
        for a in store.queued().map_err(fail)? {
            match a.queue {
                Some(QueueState::Writing) => state.generate_cancel.store(true, Ordering::Relaxed),
                Some(QueueState::Waiting) => {
                    store.delete_article(&a.id).map_err(fail)?;
                }
                _ => {}
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))??;
    emit_queue(&app, QueueEvent::Changed);
    Ok(())
}

// ----- articles -------------------------------------------------------------

#[tauri::command]
async fn list_articles(app: AppHandle, status: Option<ArticleStatus>) -> Result<Vec<ArticleSummary>, UiError> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().store.as_user(token).articles(status).map_err(fail))
        .await
        .map_err(|e| UiError::unknown(e.to_string()))?
}

#[tauri::command]
async fn get_article(app: AppHandle, id: String) -> Result<Option<Article>, UiError> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().store.as_user(token).article(&id).map_err(fail))
        .await
        .map_err(|e| UiError::unknown(e.to_string()))?
}

/// A new, empty article. The voice defaults to the person's default voice,
/// then to the newest voice, so "新しく書く" never asks first.
#[tauri::command]
async fn create_article(app: AppHandle, platform_id: Option<String>, voice_id: Option<String>) -> Result<Article, UiError> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let store = state.store.as_user(token);
        let voice_id = match voice_id {
            Some(v) => Some(v),
            None => match store.settings().map_err(fail)?.default_voice_id {
                Some(v) => Some(v),
                None => store.voices().map_err(fail)?.into_iter().next().map(|v| v.id),
            },
        };
        store
            .create_article(&NewArticle { voice_id, platform_id: platform_id.unwrap_or_else(|| "x".into()), ..Default::default() })
            .map_err(fail)
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

#[tauri::command]
async fn update_article(app: AppHandle, id: String, patch: ArticlePatch) -> Result<(), UiError> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().store.as_user(token).update_article(&id, &patch).map_err(fail))
        .await
        .map_err(|e| UiError::unknown(e.to_string()))?
}

#[tauri::command]
async fn delete_article(app: AppHandle, id: String) -> Result<bool, UiError> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().store.as_user(token).delete_article(&id).map_err(fail))
        .await
        .map_err(|e| UiError::unknown(e.to_string()))?
}

#[tauri::command]
async fn list_versions(app: AppHandle, article_id: String) -> Result<Vec<ArticleVersion>, UiError> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().store.as_user(token).versions(&article_id).map_err(fail))
        .await
        .map_err(|e| UiError::unknown(e.to_string()))?
}

/// Snapshots the article's current text (`edited`, or `manual` when the
/// person asked for it). Skipped when the newest version already has this
/// text, so periodic snapshots never pile up identical rows.
#[tauri::command]
async fn snapshot_article(app: AppHandle, article_id: String, manual: bool) -> Result<Option<ArticleVersion>, UiError> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let store = state.store.as_user(token);
        let article = store.article(&article_id).map_err(fail)?.ok_or_else(|| UiError::invalid("no such article"))?;
        let newest = store.versions(&article_id).map_err(fail)?.into_iter().next();
        if !manual && newest.as_ref().is_some_and(|v| v.body == article.body && v.title == article.title) {
            return Ok(None);
        }
        store
            .create_version(&NewVersion {
                article_id,
                kind: if manual { VersionKind::Manual } else { VersionKind::Edited },
                title: article.title,
                body: article.body,
                prompt_sent: None,
                elapsed_ms: None,
            })
            .map(Some)
            .map_err(fail)
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

/// Makes an earlier version the current text. The state being left is kept
/// as an `edited` snapshot first, and the restore itself is recorded as a
/// `restored` version, so nothing is lost and history stays linear.
#[tauri::command]
async fn restore_version(app: AppHandle, version_id: String) -> Result<Article, UiError> {
    let token = app.state::<AppState>().access_token()?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let store = state.store.as_user(token);
        let version = store.version(&version_id).map_err(fail)?.ok_or_else(|| UiError::invalid("no such version"))?;
        let article = store.article(&version.article_id).map_err(fail)?.ok_or_else(|| UiError::invalid("no such article"))?;
        if article.body != version.body || article.title != version.title {
            let newest = store.versions(&article.id).map_err(fail)?.into_iter().next();
            if !newest.as_ref().is_some_and(|v| v.body == article.body && v.title == article.title) {
                store
                    .create_version(&NewVersion { article_id: article.id.clone(), kind: VersionKind::Edited, title: article.title.clone(), body: article.body.clone(), prompt_sent: None, elapsed_ms: None })
                    .map_err(fail)?;
            }
        }
        store
            .create_version(&NewVersion { article_id: article.id.clone(), kind: VersionKind::Restored, title: version.title.clone(), body: version.body.clone(), prompt_sent: None, elapsed_ms: None })
            .map_err(fail)?;
        store
            .update_article(&article.id, &ArticlePatch { title: Some(version.title), body: Some(version.body), ..Default::default() })
            .map_err(fail)?;
        store.article(&article.id).map_err(fail)?.ok_or_else(|| UiError::invalid("article vanished"))
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

// ----- sources (D-43) ---------------------------------------------------------

/// Progress of a service import, for the row's loading state (#83).
/// `total` is unknown until the listing has arrived (Medium never knows).
#[derive(Debug, Clone, Serialize)]
pub struct ImportProgress {
    pub kind: &'static str,
    pub done: usize,
    pub total: Option<usize>,
}

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
async fn import_note(app: AppHandle, account: String) -> Result<Imported, UiError> {
    tauri::async_runtime::spawn_blocking(move || {
        let emitter = app.clone();
        let (listing, pieces) = lita_sources::note::import_with(&account, IMPORT_MAX, |done, total| {
            let _ = emitter.emit("import-progress", ImportProgress { kind: "note", done, total: Some(total) });
        })
        .map_err(fail)?;
        Ok(Imported { pieces, total: Some(listing.total_count), skipped_paid: listing.skipped_paid, recent_only: false })
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

#[tauri::command]
async fn import_medium(app: AppHandle, handle: String) -> Result<Imported, UiError> {
    tauri::async_runtime::spawn_blocking(move || {
        let _ = app.emit("import-progress", ImportProgress { kind: "medium", done: 0, total: None });
        let pieces = lita_sources::medium::import(&handle).map_err(fail)?;
        let _ = app.emit("import-progress", ImportProgress { kind: "medium", done: pieces.len(), total: Some(pieces.len()) });
        Ok(Imported { pieces, total: None, skipped_paid: 0, recent_only: true })
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

/// `contents` is the text of `data/tweets.js` from the archive, read by
/// the UI. Newest posts first, capped like the other imports.
#[tauri::command]
async fn import_x_archive(contents: String, handle: Option<String>, include_replies: bool) -> Result<Imported, UiError> {
    tauri::async_runtime::spawn_blocking(move || {
        let opts = lita_sources::x::Options { include_replies, ..Default::default() };
        let mut pieces = lita_sources::x::parse_tweets_js(&contents, handle.as_deref(), opts).map_err(fail)?;
        let total = pieces.len() as u64;
        pieces.truncate(IMPORT_MAX);
        Ok(Imported { pieces, total: Some(total), skipped_paid: 0, recent_only: false })
    })
    .await
    .map_err(|e| UiError::unknown(e.to_string()))?
}

// ----- updates (#25) -------------------------------------------------------

/// An update the updater found, kept until the person decides to install it.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(Debug, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
pub enum DownloadEvent {
    Started { content_length: Option<u64> },
    Progress { downloaded: usize, content_length: Option<u64> },
    Finished,
}

/// Asks the release feed whether a newer version exists. `None` means this
/// is the latest. Errors are ordinary UiErrors (network etc.).
#[tauri::command]
async fn fetch_update(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<Option<UpdateInfo>, UiError> {
    let update = app
        .updater()
        .map_err(|e| UiError::unknown(e.to_string()))?
        .check()
        .await
        .map_err(|e| UiError::unknown(format!("checking for updates: {e}")))?;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    });
    *pending.0.lock().map_err(|_| UiError::unknown("update state poisoned"))? = update;
    Ok(info)
}

/// Downloads and installs the pending update, reporting progress on
/// `on_event`. The app must be restarted afterwards (`restart_app`).
#[tauri::command]
async fn install_update(pending: State<'_, PendingUpdate>, on_event: tauri::ipc::Channel<DownloadEvent>) -> Result<(), UiError> {
    let update = pending
        .0
        .lock()
        .map_err(|_| UiError::unknown("update state poisoned"))?
        .take()
        .ok_or_else(|| UiError::invalid("no update is pending; check first"))?;
    let mut downloaded = 0usize;
    let mut started = false;
    update
        .download_and_install(
            |chunk, total| {
                if !started {
                    started = true;
                    let _ = on_event.send(DownloadEvent::Started { content_length: total });
                }
                downloaded += chunk;
                let _ = on_event.send(DownloadEvent::Progress { downloaded, content_length: total });
            },
            || {
                let _ = on_event.send(DownloadEvent::Finished);
            },
        )
        .await
        .map_err(|e| UiError::unknown(format!("installing the update: {e}")))?;
    Ok(())
}

#[tauri::command]
fn restart_app(app: AppHandle) {
    app.restart();
}

#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // GUI apps do not inherit the shell's PATH; without this `codex` (npm,
    // Homebrew) is invisible on a distributed build.
    let _ = fix_path_env::fix();
    let state = AppState::new().expect("Supabase configuration is valid");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .manage(state)
        .manage(PendingUpdate::default())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

            // The menu bar. On macOS the first submenu is the app menu; the
            // Edit items are the predefined ones so text fields keep their
            // shortcuts. "Check for updates" is the one custom item (#25).
            let check = MenuItemBuilder::with_id("check_update", "アップデートを確認…").build(app)?;
            let app_menu = SubmenuBuilder::new(app, "Lita")
                .item(&PredefinedMenuItem::about(app, None, None)?)
                .separator()
                .item(&check)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;
            let edit = SubmenuBuilder::new(app, "編集")
                .undo().redo().separator().cut().copy().paste().select_all()
                .build()?;
            let window = SubmenuBuilder::new(app, "ウインドウ").minimize().maximize().separator().close_window().build()?;
            let menu = MenuBuilder::new(app).items(&[&app_menu, &edit, &window]).build()?;
            app.set_menu(menu)?;
            app.on_menu_event(|handle, event| {
                if event.id().0 == "check_update" {
                    let _ = handle.emit("check-update", ());
                }
            });

            // Off the main thread: the refresh is a network round trip.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || handle.state::<AppState>().restore());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            codex_status,
            session_status,
            sign_in,
            cancel_sign_in,
            sign_out,
            list_voices,
            get_voice,
            delete_voice,
            rename_voice,
            update_voice_profile,
            create_voice,
            add_voice_sources,
            remove_voice_sources,
            remove_voice_source,
            rebuild_voice,
            cancel_voice_build,
            material_budget,
            platforms,
            preview_prompt,
            generate_draft,
            cancel_generate,
            get_policy,
            set_policy,
            draft_policy,
            suggest_topics,
            enqueue_articles,
            start_queue,
            dequeue_article,
            clear_queue,
            set_draft_status,
            generate_into_article,
            list_articles,
            get_article,
            create_article,
            update_article,
            delete_article,
            list_versions,
            snapshot_article,
            restore_version,
            import_note,
            import_medium,
            import_x_archive,
            fetch_update,
            install_update,
            restart_app,
            app_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
