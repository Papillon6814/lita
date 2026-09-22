//! Probe for #26 (method B): sign in through Supabase's Google provider
//! with PKCE and a loopback redirect, then read through RLS.
//!
//! Env: LITA_SUPABASE_URL, LITA_SUPABASE_ANON_KEY.

use std::time::Instant;

use anyhow::{Context, Result};
use lita_auth::SupabaseAuth;

fn main() -> Result<()> {
    let url = std::env::var("LITA_SUPABASE_URL").context("LITA_SUPABASE_URL is not set")?;
    let key = std::env::var("LITA_SUPABASE_ANON_KEY").context("LITA_SUPABASE_ANON_KEY is not set")?;
    let auth = SupabaseAuth::new(&url, &key)?;

    let started = Instant::now();
    let session = auth.sign_in_with_provider("google", |u| {
        println!("opening browser: {u}");
        std::process::Command::new("open").arg(u.as_str()).status()?;
        Ok(())
    })?;
    println!(
        "supabase ok in {:.1}s: user={} email={:?} expires_in={}s",
        started.elapsed().as_secs_f32(),
        session.user.id,
        session.user.email,
        session.expires_in
    );
    let refreshed = auth.refresh(&session.refresh_token)?;
    println!("refresh ok: access_token={} bytes", refreshed.access_token.len());

    let rows: serde_json::Value = reqwest::blocking::Client::new()
        .get(format!("{url}/rest/v1/platforms?select=id,name,max_chars"))
        .header("apikey", &key)
        .bearer_auth(&refreshed.access_token)
        .send()?
        .error_for_status()?
        .json()?;
    println!("postgrest ok: platforms={rows}");
    Ok(())
}
