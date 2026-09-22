//! Sign-in through Supabase Auth.
//!
//! Supabase runs the Google OAuth dance on its own callback URL and holds
//! the Google client secret, so nothing secret ships in the app (D-41). The
//! app does PKCE against Supabase: it opens the browser on Supabase's
//! `/authorize`, receives the code on a loopback port, and trades it for a
//! session with the code verifier.

use std::time::Duration;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use url::Url;

use std::sync::atomic::AtomicBool;

use crate::loopback::{Callback, wait_for_callback_cancellable};

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
    timeout: Duration,
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
            timeout: Duration::from_secs(300),
        })
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Signs in with an external provider (`"google"`). `open_browser` is
    /// called once with the URL to visit; the caller decides how to open it.
    pub fn sign_in_with_provider(
        &self,
        provider: &str,
        open_browser: impl FnOnce(&Url) -> Result<()>,
    ) -> Result<Session> {
        self.sign_in_with_provider_cancellable(provider, open_browser, &AtomicBool::new(false))
    }

    /// As above, but stops waiting for the browser once `cancel` is set.
    pub fn sign_in_with_provider_cancellable(
        &self,
        provider: &str,
        open_browser: impl FnOnce(&Url) -> Result<()>,
        cancel: &AtomicBool,
    ) -> Result<Session> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").context("binding a loopback port")?;
        let port = listener.local_addr()?.port();
        let redirect_to = format!("http://127.0.0.1:{port}/");

        let verifier = random_urlsafe(64);
        let challenge = base64_url(&sha256(verifier.as_bytes()));

        let mut authorize = Url::parse(&format!("{}/auth/v1/authorize", self.base_url))?;
        authorize
            .query_pairs_mut()
            .append_pair("provider", provider)
            .append_pair("redirect_to", &redirect_to)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "s256");

        open_browser(&authorize)?;
        let Callback { code, .. } = wait_for_callback_cancellable(listener, self.timeout, cancel)?;

        #[derive(Serialize)]
        struct Body<'a> {
            auth_code: &'a str,
            code_verifier: &'a str,
        }
        self.token_request("pkce", &Body { auth_code: &code, code_verifier: &verifier })
    }

    /// `POST /auth/v1/token?grant_type=refresh_token`.
    pub fn refresh(&self, refresh_token: &str) -> Result<Session> {
        #[derive(Serialize)]
        struct Body<'a> {
            refresh_token: &'a str,
        }
        self.token_request("refresh_token", &Body { refresh_token })
    }

    fn token_request<B: Serialize>(&self, grant_type: &str, body: &B) -> Result<Session> {
        let resp = self
            .http
            .post(format!("{}/auth/v1/token?grant_type={grant_type}", self.base_url))
            .header("apikey", &self.anon_key)
            .json(body)
            .send()
            .context("reaching Supabase Auth")?;
        let status = resp.status();
        let text = resp.text()?;
        if !status.is_success() {
            let parsed: ErrorBody =
                serde_json::from_str(&text).unwrap_or(ErrorBody { error: None, code: None });
            bail!(
                "Supabase refused the {grant_type} request ({status}{}): {}",
                parsed.code.map(|c| format!(", {c}")).unwrap_or_default(),
                parsed.error.unwrap_or(text)
            );
        }
        serde_json::from_str(&text).context("reading the session Supabase returned")
    }
}

fn sha256(input: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    Sha256::digest(input).into()
}

/// Base64url without padding, as PKCE requires.
fn base64_url(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(ALPHABET[(n >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
            out.push(ALPHABET[(n >> 6) as usize & 63] as char);
        }
        if chunk.len() > 2 {
            out.push(ALPHABET[n as usize & 63] as char);
        }
    }
    out
}

/// A random string from the PKCE unreserved alphabet.
fn random_urlsafe(len: usize) -> String {
    let mut bytes = vec![0u8; len];
    getrandom::fill(&mut bytes).expect("the OS random source is available");
    base64_url(&bytes).chars().take(len).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_url_matches_rfc_7636_appendix_b() {
        // RFC 7636 Appendix B: this verifier hashes to this challenge.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(base64_url(&sha256(verifier.as_bytes())), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn random_verifier_has_the_requested_length_and_alphabet() {
        let v = random_urlsafe(64);
        assert_eq!(v.len(), 64);
        assert!(v.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_ne!(v, random_urlsafe(64));
    }
}
