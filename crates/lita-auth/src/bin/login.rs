//! Probe for #26: does the loopback + PKCE flow work against a real Google
//! Desktop client, and does Supabase accept the resulting ID token?
//!
//! Env: LITA_GOOGLE_CLIENT_ID (required), LITA_GOOGLE_CLIENT_SECRET (optional,
//! to test whether Google insists on it), LITA_SUPABASE_URL and
//! LITA_SUPABASE_ANON_KEY (optional; skips the Supabase step if absent).

use std::time::Instant;

use anyhow::{Context, Result};
use lita_auth::{GoogleSignIn, SupabaseAuth};

fn main() -> Result<()> {
    let client_id = std::env::var("LITA_GOOGLE_CLIENT_ID").context("LITA_GOOGLE_CLIENT_ID is not set")?;
    let secret = std::env::var("LITA_GOOGLE_CLIENT_SECRET").ok();
    println!("client secret: {}", if secret.is_some() { "provided" } else { "omitted" });

    let started = Instant::now();
    let identity = GoogleSignIn::new(client_id).with_client_secret(secret).run(|url| {
        println!("opening browser: {url}");
        std::process::Command::new("open").arg(url.as_str()).status()?;
        Ok(())
    })?;
    println!(
        "google ok in {:.1}s: sub={} email={:?} name={:?} id_token={} bytes",
        started.elapsed().as_secs_f32(),
        identity.subject,
        identity.email,
        identity.name,
        identity.id_token.len()
    );

    let (Ok(url), Ok(key)) = (std::env::var("LITA_SUPABASE_URL"), std::env::var("LITA_SUPABASE_ANON_KEY")) else {
        println!("LITA_SUPABASE_URL / LITA_SUPABASE_ANON_KEY not set; stopping after Google");
        return Ok(());
    };
    let auth = SupabaseAuth::new(url, key)?;
    let session = auth.sign_in_with_google_id_token(&identity.id_token, &identity.nonce)?;
    println!(
        "supabase ok: user={} email={:?} expires_in={}s access_token={} bytes",
        session.user.id,
        session.user.email,
        session.expires_in,
        session.access_token.len()
    );
    let refreshed = auth.refresh(&session.refresh_token)?;
    println!("refresh ok: new access_token={} bytes", refreshed.access_token.len());
    Ok(())
}
