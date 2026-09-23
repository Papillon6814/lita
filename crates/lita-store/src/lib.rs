//! Lita's data, read and written through PostgREST as the signed-in user.
//!
//! Every call carries the person's Supabase access token, and the database
//! enforces ownership with row level security (see
//! `supabase/migrations/20260922000000_init.sql`). This crate therefore
//! never filters by user itself: what the server returns is, by
//! construction, only that person's rows.

use anyhow::{Context, Result, bail};
use lita_codex::Effort;
use lita_codex::voice::VoiceProfile;
pub use lita_codex::topics::Policy;
use reqwest::blocking::{Client, RequestBuilder};
use reqwest::header::{ACCEPT, AUTHORIZATION, HeaderValue};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::json;

/// A row id: a UUID as PostgREST prints it.
pub type Id = String;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Platform {
    pub id: String,
    pub name: String,
    pub max_chars: Option<i64>,
    pub rules: String,
}

/// A voice as listed. The profile is left out because lists do not need it
/// and it is the bulk of the row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VoiceSummary {
    pub id: Id,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub source_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Voice {
    pub id: Id,
    pub name: String,
    pub profile: VoiceProfile,
    pub created_at: String,
    pub updated_at: String,
    #[serde(rename = "voice_sources", default)]
    pub sources: Vec<VoiceSource>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    Paste,
    File,
    /// A note.com article; `origin` is its URL.
    Note,
    /// A Medium post; `origin` is its URL.
    Medium,
    /// A post from an X archive; `origin` is its URL when the handle was known.
    X,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VoiceSource {
    pub id: Id,
    pub kind: SourceKind,
    /// File name for `File`; `None` for `Paste`.
    pub origin: Option<String>,
    /// Where the piece was imported from: the note account or Medium handle,
    /// `archive` for an X archive, `None` for pasted text and files (#68).
    #[serde(default)]
    pub account: Option<String>,
    pub body: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NewSource {
    pub kind: SourceKind,
    pub origin: Option<String>,
    #[serde(default)]
    pub account: Option<String>,
    pub body: String,
}

/// `Effort` as the database spells it. Kept separate from
/// `lita_codex::Effort` so the CLI mapping ("low"/"medium") and the storage
/// mapping ("fast"/"quality") can drift independently.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StoredEffort {
    Fast,
    Quality,
}

impl From<Effort> for StoredEffort {
    fn from(e: Effort) -> Self {
        match e {
            Effort::Fast => StoredEffort::Fast,
            Effort::Quality => StoredEffort::Quality,
        }
    }
}

impl From<StoredEffort> for Effort {
    fn from(e: StoredEffort) -> Self {
        match e {
            StoredEffort::Fast => Effort::Fast,
            StoredEffort::Quality => Effort::Quality,
        }
    }
}

/// Where an article stands. `Approved` means the person took it (copied it
/// out); `Archived` means they put it away without using it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArticleStatus {
    Draft,
    Approved,
    Archived,
}

/// Where a queued article stands (article queue, 2026-09-23). Cleared once
/// the text is written, so an ordinary article has none.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueueState {
    Waiting,
    Writing,
    Failed,
}

/// One piece of writing: its own brief, voice, destination, current text,
/// and (in `article_versions`) a history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Article {
    pub id: Id,
    pub voice_id: Option<Id>,
    pub platform_id: String,
    pub title: String,
    pub body: String,
    pub brief: String,
    pub status: ArticleStatus,
    #[serde(default)]
    pub queue: Option<QueueState>,
    pub created_at: String,
    pub updated_at: String,
}

/// An article as listed: no body, but a short excerpt for the list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArticleSummary {
    pub id: Id,
    pub voice_id: Option<Id>,
    pub platform_id: String,
    pub title: String,
    pub excerpt: String,
    pub status: ArticleStatus,
    #[serde(default)]
    pub queue: Option<QueueState>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct NewArticle {
    pub voice_id: Option<Id>,
    pub platform_id: String,
    pub title: String,
    pub body: String,
    pub brief: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue: Option<QueueState>,
}

/// Fields of an article that can change. `None` leaves a field as it is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ArticlePatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voice_id: Option<Option<Id>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brief: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<ArticleStatus>,
    /// `Some(None)` clears the queue mark.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue: Option<Option<QueueState>>,
}

/// What produced a version (see the migration for the meaning of each).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VersionKind {
    Generated,
    Shortened,
    Edited,
    Restored,
    Manual,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArticleVersion {
    pub id: Id,
    pub article_id: Id,
    pub kind: VersionKind,
    pub title: String,
    pub body: String,
    /// For generated / shortened: exactly what went to Codex (B-08).
    pub prompt_sent: Option<String>,
    pub elapsed_ms: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NewVersion {
    pub article_id: Id,
    pub kind: VersionKind,
    pub title: String,
    pub body: String,
    pub prompt_sent: Option<String>,
    pub elapsed_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct UserSettings {
    pub default_voice_id: Option<Id>,
    #[serde(default)]
    pub policy: Policy,
}

/// Connection details for one Supabase project. Cheap to clone.
#[derive(Clone)]
pub struct Store {
    rest_url: String,
    anon_key: String,
    http: Client,
}

/// `Store` bound to one person's access token.
pub struct UserStore<'a> {
    store: &'a Store,
    access_token: String,
}

impl Store {
    /// `base_url` is the project URL, e.g. `https://<ref>.supabase.co`.
    pub fn new(base_url: impl Into<String>, anon_key: impl Into<String>) -> Result<Self> {
        Ok(Self {
            rest_url: format!("{}/rest/v1", base_url.into().trim_end_matches('/')),
            anon_key: anon_key.into(),
            http: Client::builder().build()?,
        })
    }

    pub fn as_user(&self, access_token: impl Into<String>) -> UserStore<'_> {
        UserStore { store: self, access_token: access_token.into() }
    }
}

impl UserStore<'_> {
    // ----- platforms -------------------------------------------------------

    pub fn platforms(&self) -> Result<Vec<Platform>> {
        self.get_many("platforms", &[("select", "*"), ("order", "name")])
    }

    // ----- voices ----------------------------------------------------------

    pub fn voices(&self) -> Result<Vec<VoiceSummary>> {
        #[derive(Deserialize)]
        struct Row {
            id: Id,
            name: String,
            created_at: String,
            updated_at: String,
            voice_sources: Vec<Count>,
        }
        #[derive(Deserialize)]
        struct Count {
            count: i64,
        }
        let rows: Vec<Row> = self.get_many(
            "voices",
            &[("select", "id,name,created_at,updated_at,voice_sources(count)"), ("order", "created_at.desc")],
        )?;
        Ok(rows
            .into_iter()
            .map(|r| VoiceSummary {
                id: r.id,
                name: r.name,
                created_at: r.created_at,
                updated_at: r.updated_at,
                source_count: r.voice_sources.first().map_or(0, |c| c.count),
            })
            .collect())
    }

    pub fn voice(&self, id: &str) -> Result<Option<Voice>> {
        let rows: Vec<Voice> = self.get_many(
            "voices",
            &[("select", "*,voice_sources(*)"), ("id", &format!("eq.{id}")), ("limit", "1")],
        )?;
        Ok(rows.into_iter().next())
    }

    /// Stores a voice together with the writing it was extracted from. Two
    /// requests, so not atomic: if the sources fail to insert, the voice is
    /// removed again rather than left half-made.
    pub fn create_voice(&self, name: &str, profile: &VoiceProfile, sources: &[NewSource]) -> Result<Voice> {
        let created: Voice = self.insert_one("voices", &json!({ "name": name, "profile": profile }))?;
        if let Err(e) = self.insert_sources(&created.id, sources) {
            let _ = self.delete_voice(&created.id);
            return Err(e);
        }
        self.voice(&created.id)?.context("the voice just created is not readable")
    }

    pub fn rename_voice(&self, id: &str, name: &str) -> Result<()> {
        self.patch_one("voices", id, &json!({ "name": name }))
    }

    /// Updates the profile in place (the person corrected a field). Sources
    /// stay as they were: the profile was still built from them.
    pub fn update_profile(&self, id: &str, profile: &VoiceProfile) -> Result<()> {
        self.patch_one("voices", id, &json!({ "profile": profile }))
    }

    /// Replaces the profile after a re-extraction. Sources are replaced too,
    /// since the new profile was built from them.
    pub fn replace_voice_profile(&self, id: &str, profile: &VoiceProfile, sources: &[NewSource]) -> Result<()> {
        self.patch_one("voices", id, &json!({ "profile": profile }))?;
        self.request(self.store.http.delete(self.url("voice_sources")).query(&[("voice_id", format!("eq.{id}"))]))?;
        self.insert_sources(id, sources)
    }

    /// Adds writing to an existing voice (a new connection, or new articles
    /// from one). The profile is left alone: relearning is a separate step.
    pub fn add_sources(&self, voice_id: &str, sources: &[NewSource]) -> Result<()> {
        self.insert_sources(voice_id, sources)
    }

    /// Drops one connection's pieces: every source of `kind` from `account`
    /// (`None` matches the pasted / file pieces, which have no account).
    pub fn delete_sources(&self, voice_id: &str, kind: SourceKind, account: Option<&str>) -> Result<()> {
        let kind = serde_json::to_value(kind)?.as_str().context("kind")?.to_string();
        let mut q = vec![("voice_id", format!("eq.{voice_id}")), ("kind", format!("eq.{kind}"))];
        q.push(match account {
            Some(a) => ("account", format!("eq.{a}")),
            None => ("account", "is.null".into()),
        });
        self.request(self.store.http.delete(self.url("voice_sources")).query(&q))?;
        Ok(())
    }

    /// Drops one piece by id (a pasted post or a file the person wants out).
    pub fn delete_source(&self, voice_id: &str, source_id: &str) -> Result<()> {
        self.request(
            self.store.http.delete(self.url("voice_sources")).query(&[("voice_id", format!("eq.{voice_id}")), ("id", format!("eq.{source_id}"))]),
        )?;
        Ok(())
    }

    /// Deletes a voice and, through `ON DELETE CASCADE`, its sources. Articles
    /// that used it keep their text and lose the link (`voice_id` becomes
    /// null). Returns whether a row was deleted.
    pub fn delete_voice(&self, id: &str) -> Result<bool> {
        let deleted: Vec<serde_json::Value> = self.parse(self.request(
            self.store
                .http
                .delete(self.url("voices"))
                .query(&[("id", format!("eq.{id}")), ("select", "id".into())])
                .header("Prefer", "return=representation"),
        )?)?;
        Ok(!deleted.is_empty())
    }

    fn insert_sources(&self, voice_id: &str, sources: &[NewSource]) -> Result<()> {
        if sources.is_empty() {
            return Ok(());
        }
        let rows: Vec<serde_json::Value> = sources
            .iter()
            .map(|s| json!({ "voice_id": voice_id, "kind": s.kind, "origin": s.origin, "account": s.account, "body": s.body }))
            .collect();
        self.request(
            self.store.http.post(self.url("voice_sources")).header("Prefer", "return=minimal").json(&rows),
        )?;
        Ok(())
    }

    // ----- articles --------------------------------------------------------

    /// Newest first. `status` narrows the list; `None` lists everything.
    pub fn articles(&self, status: Option<ArticleStatus>) -> Result<Vec<ArticleSummary>> {
        #[derive(Deserialize)]
        struct Row {
            id: Id,
            voice_id: Option<Id>,
            platform_id: String,
            title: String,
            body: String,
            status: ArticleStatus,
            #[serde(default)]
            queue: Option<QueueState>,
            created_at: String,
            updated_at: String,
        }
        let mut query: Vec<(&str, String)> = vec![
            ("select", "id,voice_id,platform_id,title,body,status,queue,created_at,updated_at".into()),
            ("order", "updated_at.desc".into()),
        ];
        let status_value = status.map(|s| serde_json::to_value(s).unwrap_or_default().as_str().unwrap_or("").to_string());
        if let Some(v) = &status_value {
            query.push(("status", format!("eq.{v}")));
        }
        let borrowed: Vec<(&str, &str)> = query.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let rows: Vec<Row> = self.get_many("articles", &borrowed)?;
        Ok(rows
            .into_iter()
            .map(|r| ArticleSummary {
                id: r.id,
                voice_id: r.voice_id,
                platform_id: r.platform_id,
                title: r.title,
                excerpt: excerpt_of(&r.body),
                status: r.status,
                queue: r.queue,
                created_at: r.created_at,
                updated_at: r.updated_at,
            })
            .collect())
    }

    /// Articles still in the queue, oldest first (the order they were picked).
    pub fn queued(&self) -> Result<Vec<Article>> {
        self.get_many("articles", &[("queue", "not.is.null"), ("order", "created_at.asc")])
    }

    pub fn article(&self, id: &str) -> Result<Option<Article>> {
        let rows: Vec<Article> = self.get_many("articles", &[("id", &format!("eq.{id}")), ("limit", "1")])?;
        Ok(rows.into_iter().next())
    }

    pub fn create_article(&self, new: &NewArticle) -> Result<Article> {
        self.insert_one("articles", new)
    }

    pub fn update_article(&self, id: &str, patch: &ArticlePatch) -> Result<()> {
        self.patch_one("articles", id, patch)
    }

    /// Deletes an article and, through `ON DELETE CASCADE`, its versions.
    pub fn delete_article(&self, id: &str) -> Result<bool> {
        let deleted: Vec<serde_json::Value> = self.parse(self.request(
            self.store
                .http
                .delete(self.url("articles"))
                .query(&[("id", format!("eq.{id}")), ("select", "id".into())])
                .header("Prefer", "return=representation"),
        )?)?;
        Ok(!deleted.is_empty())
    }

    // ----- versions --------------------------------------------------------

    /// Newest first.
    pub fn versions(&self, article_id: &str) -> Result<Vec<ArticleVersion>> {
        self.get_many(
            "article_versions",
            &[("article_id", &format!("eq.{article_id}")), ("order", "created_at.desc")],
        )
    }

    pub fn version(&self, id: &str) -> Result<Option<ArticleVersion>> {
        let rows: Vec<ArticleVersion> =
            self.get_many("article_versions", &[("id", &format!("eq.{id}")), ("limit", "1")])?;
        Ok(rows.into_iter().next())
    }

    pub fn create_version(&self, new: &NewVersion) -> Result<ArticleVersion> {
        self.insert_one("article_versions", new)
    }

    // ----- settings --------------------------------------------------------

    pub fn settings(&self) -> Result<UserSettings> {
        let rows: Vec<UserSettings> = self.get_many("user_settings", &[("select", "default_voice_id,policy"), ("limit", "1")])?;
        Ok(rows.into_iter().next().unwrap_or_default())
    }

    /// Upsert of the editorial policy (one per person).
    pub fn set_policy(&self, policy: &Policy) -> Result<()> {
        self.request(
            self.store
                .http
                .post(self.url("user_settings"))
                .header("Prefer", "resolution=merge-duplicates,return=minimal")
                .json(&json!({ "policy": policy })),
        )?;
        Ok(())
    }

    /// Upsert: the row is created the first time a setting is written.
    pub fn set_default_voice(&self, voice_id: Option<&str>) -> Result<()> {
        self.request(
            self.store
                .http
                .post(self.url("user_settings"))
                .header("Prefer", "resolution=merge-duplicates,return=minimal")
                .json(&json!({ "default_voice_id": voice_id })),
        )?;
        Ok(())
    }

    // ----- plumbing --------------------------------------------------------

    fn url(&self, table: &str) -> String {
        format!("{}/{table}", self.store.rest_url)
    }

    fn get_many<T: DeserializeOwned>(&self, table: &str, query: &[(&str, &str)]) -> Result<Vec<T>> {
        self.parse(self.request(self.store.http.get(self.url(table)).query(query))?)
    }

    fn insert_one<T: DeserializeOwned, B: Serialize>(&self, table: &str, body: &B) -> Result<T> {
        self.parse(self.request(
            self.store
                .http
                .post(self.url(table))
                .header("Prefer", "return=representation")
                .header(ACCEPT, HeaderValue::from_static("application/vnd.pgrst.object+json"))
                .json(body),
        )?)
    }

    fn patch_one<B: Serialize>(&self, table: &str, id: &str, body: &B) -> Result<()> {
        let updated: Vec<serde_json::Value> = self.parse(self.request(
            self.store
                .http
                .patch(self.url(table))
                .query(&[("id", format!("eq.{id}")), ("select", "id".into())])
                .header("Prefer", "return=representation")
                .json(body),
        )?)?;
        if updated.is_empty() {
            bail!("no {table} row with id {id} (or it is not yours)");
        }
        Ok(())
    }

    fn request(&self, builder: RequestBuilder) -> Result<String> {
        let resp = builder
            .header("apikey", &self.store.anon_key)
            .header(AUTHORIZATION, format!("Bearer {}", self.access_token))
            .send()
            .context("reaching Supabase")?;
        let status = resp.status();
        let text = resp.text()?;
        if !status.is_success() {
            #[derive(Deserialize)]
            struct PgError {
                message: Option<String>,
                code: Option<String>,
            }
            let parsed: PgError = serde_json::from_str(&text).unwrap_or(PgError { message: None, code: None });
            bail!(
                "Supabase returned {status}{}: {}",
                parsed.code.map(|c| format!(" ({c})")).unwrap_or_default(),
                parsed.message.unwrap_or(text)
            );
        }
        Ok(text)
    }

    fn parse<T: DeserializeOwned>(&self, text: String) -> Result<T> {
        let text = if text.is_empty() { "[]".to_string() } else { text };
        serde_json::from_str(&text).context("reading what Supabase returned")
    }
}

/// The first line or so of a body, for lists.
fn excerpt_of(body: &str) -> String {
    let first = body.trim().lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
    let mut out: String = first.chars().take(80).collect();
    if first.chars().count() > 80 {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excerpt_is_the_first_non_empty_line_cut_short() {
        assert_eq!(excerpt_of("\n\n  短い一行  \n二行目"), "短い一行");
        let long = "あ".repeat(100);
        let e = excerpt_of(&long);
        assert_eq!(e.chars().count(), 81);
        assert!(e.ends_with('…'));
    }

    #[test]
    fn article_patch_serialises_only_what_is_set() {
        let p = ArticlePatch { body: Some("x".into()), voice_id: Some(None), ..Default::default() };
        assert_eq!(serde_json::to_string(&p).unwrap(), r#"{"voice_id":null,"body":"x"}"#);
        assert_eq!(serde_json::to_string(&ArticlePatch::default()).unwrap(), "{}");
    }

    #[test]
    fn effort_maps_both_ways() {
        assert_eq!(StoredEffort::from(Effort::Fast), StoredEffort::Fast);
        assert_eq!(Effort::from(StoredEffort::Quality), Effort::Quality);
        assert_eq!(serde_json::to_string(&StoredEffort::Fast).unwrap(), "\"fast\"");
        assert_eq!(serde_json::to_string(&ArticleStatus::Archived).unwrap(), "\"archived\"");
        assert_eq!(serde_json::to_string(&VersionKind::Shortened).unwrap(), "\"shortened\"");
        assert_eq!(serde_json::to_string(&SourceKind::Paste).unwrap(), "\"paste\"");
    }

    #[test]
    fn voice_row_with_embedded_sources_parses() {
        let text = r#"{"id":"u1","user_id":"x","name":"me","profile":{"language":"ja","first_person":"僕","formality":"casual","tone":[],"sentence_endings":[],"avg_sentence_length_chars":20,"preferred_words":[],"avoided_words":[],"opens_with":"","closes_with":"","uses_emoji":false,"representative_excerpts":[]},"created_at":"t","updated_at":"t","voice_sources":[{"id":"s1","user_id":"x","voice_id":"u1","kind":"file","origin":"a.txt","body":"b","created_at":"t"}]}"#;
        let v: Voice = serde_json::from_str(text).unwrap();
        assert_eq!(v.sources.len(), 1);
        assert_eq!(v.sources[0].kind, SourceKind::File);
        assert_eq!(v.profile.first_person, "僕");
    }
}
