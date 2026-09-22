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
    pub body: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NewSource {
    pub kind: SourceKind,
    pub origin: Option<String>,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Brief {
    pub id: Id,
    pub voice_id: Id,
    pub platform_id: String,
    pub body: String,
    pub effort: StoredEffort,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NewBrief {
    pub voice_id: Id,
    pub platform_id: String,
    pub body: String,
    pub effort: StoredEffort,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DraftStatus {
    Pending,
    Approved,
    Discarded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Draft {
    pub id: Id,
    pub brief_id: Id,
    pub body: String,
    /// Exactly what was sent to Codex. Kept so the person can audit it.
    pub prompt_sent: String,
    pub model: Option<String>,
    pub elapsed_ms: i64,
    pub status: DraftStatus,
    pub created_at: String,
    pub decided_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NewDraft {
    pub brief_id: Id,
    pub body: String,
    pub prompt_sent: String,
    pub model: Option<String>,
    pub elapsed_ms: i64,
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

    /// Replaces the profile after a re-extraction. Sources are replaced too,
    /// since the new profile was built from them.
    pub fn replace_voice_profile(&self, id: &str, profile: &VoiceProfile, sources: &[NewSource]) -> Result<()> {
        self.patch_one("voices", id, &json!({ "profile": profile }))?;
        self.request(self.store.http.delete(self.url("voice_sources")).query(&[("voice_id", format!("eq.{id}"))]))?;
        self.insert_sources(id, sources)
    }

    /// Deletes a voice and, through `ON DELETE CASCADE`, its sources, briefs,
    /// and drafts. Returns whether a row was deleted.
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
            .map(|s| json!({ "voice_id": voice_id, "kind": s.kind, "origin": s.origin, "body": s.body }))
            .collect();
        self.request(
            self.store.http.post(self.url("voice_sources")).header("Prefer", "return=minimal").json(&rows),
        )?;
        Ok(())
    }

    // ----- briefs and drafts -----------------------------------------------

    pub fn create_brief(&self, new: &NewBrief) -> Result<Brief> {
        self.insert_one("briefs", new)
    }

    pub fn brief(&self, id: &str) -> Result<Option<Brief>> {
        let rows: Vec<Brief> = self.get_many("briefs", &[("id", &format!("eq.{id}")), ("limit", "1")])?;
        Ok(rows.into_iter().next())
    }

    pub fn briefs_for_voice(&self, voice_id: &str) -> Result<Vec<Brief>> {
        self.get_many("briefs", &[("voice_id", &format!("eq.{voice_id}")), ("order", "created_at.desc")])
    }

    pub fn create_draft(&self, new: &NewDraft) -> Result<Draft> {
        self.insert_one("drafts", new)
    }

    pub fn draft(&self, id: &str) -> Result<Option<Draft>> {
        let rows: Vec<Draft> = self.get_many("drafts", &[("id", &format!("eq.{id}")), ("limit", "1")])?;
        Ok(rows.into_iter().next())
    }

    pub fn drafts_for_brief(&self, brief_id: &str) -> Result<Vec<Draft>> {
        self.get_many("drafts", &[("brief_id", &format!("eq.{brief_id}")), ("order", "created_at")])
    }

    /// Records the person's decision. A decision can be changed; `decided_at`
    /// always reflects the latest one, and clears when going back to pending.
    pub fn set_draft_status(&self, id: &str, status: DraftStatus) -> Result<()> {
        let decided_at = match status {
            DraftStatus::Pending => serde_json::Value::Null,
            _ => json!("now()"),
        };
        self.patch_one("drafts", id, &json!({ "status": status, "decided_at": decided_at }))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effort_maps_both_ways() {
        assert_eq!(StoredEffort::from(Effort::Fast), StoredEffort::Fast);
        assert_eq!(Effort::from(StoredEffort::Quality), Effort::Quality);
        assert_eq!(serde_json::to_string(&StoredEffort::Fast).unwrap(), "\"fast\"");
        assert_eq!(serde_json::to_string(&DraftStatus::Discarded).unwrap(), "\"discarded\"");
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
