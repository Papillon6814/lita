//! The Supabase half: trade a Google ID token for a Lita session.

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

/// A signed-in Lita session. This is what gets persisted (in the OS
/// keychain, never in a file) and sent as the bearer token to PostgREST.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
    pub user: User,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub email: Option<String>,
}

pub struct SupabaseAuth {
    base_url: String,
    anon_key: String,
    http: reqwest::blocking::Client,
}

#[derive(Deserialize)]
struct ErrorBody {
    #[serde(alias = "error_description", alias = "msg", alias = "message")]
    error: Option<String>,
    #[serde(alias = "error_code")]
    code: Option<String>,
}

impl SupabaseAuth {
    /// `base_url` is the project URL, e.g. `https://<ref>.supabase.co`.
    pub fn new(base_url: impl Into<String>, anon_key: impl Into<String>) -> Result<Self> {
        Ok(Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            anon_key: anon_key.into(),
            http: reqwest::blocking::Client::builder().build()?,
        })
    }

    /// `POST /auth/v1/token?grant_type=id_token`. The Google client must be
    /// listed in the project's Google provider settings for this to work.
    pub fn sign_in_with_google_id_token(&self, id_token: &str, nonce: &str) -> Result<Session> {
        #[derive(Serialize)]
        struct Body<'a> {
            provider: &'a str,
            id_token: &'a str,
            nonce: &'a str,
        }
        let resp = self
            .http
            .post(format!("{}/auth/v1/token?grant_type=id_token", self.base_url))
            .header("apikey", &self.anon_key)
            .json(&Body { provider: "google", id_token, nonce })
            .send()
            .context("reaching Supabase Auth")?;
        let status = resp.status();
        let text = resp.text()?;
        if !status.is_success() {
            let parsed: ErrorBody = serde_json::from_str(&text).unwrap_or(ErrorBody { error: None, code: None });
            bail!(
                "Supabase refused the sign-in ({status}{}): {}",
                parsed.code.map(|c| format!(", {c}")).unwrap_or_default(),
                parsed.error.unwrap_or(text)
            );
        }
        serde_json::from_str(&text).context("reading the session Supabase returned")
    }

    /// `POST /auth/v1/token?grant_type=refresh_token`.
    pub fn refresh(&self, refresh_token: &str) -> Result<Session> {
        #[derive(Serialize)]
        struct Body<'a> {
            refresh_token: &'a str,
        }
        let resp = self
            .http
            .post(format!("{}/auth/v1/token?grant_type=refresh_token", self.base_url))
            .header("apikey", &self.anon_key)
            .json(&Body { refresh_token })
            .send()
            .context("reaching Supabase Auth")?;
        let status = resp.status();
        let text = resp.text()?;
        if !status.is_success() {
            bail!("Supabase refused the refresh ({status}): {text}");
        }
        serde_json::from_str(&text).context("reading the session Supabase returned")
    }
}
