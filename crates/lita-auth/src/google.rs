//! The Google half: loopback + PKCE, ending in a verified ID token.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use openidconnect::core::{CoreAuthenticationFlow, CoreClient, CoreProviderMetadata};
use openidconnect::reqwest::blocking::Client as HttpClient;
use openidconnect::{
    AuthorizationCode, ClientId, ClientSecret, CsrfToken, IssuerUrl, Nonce, OAuth2TokenResponse,
    PkceCodeChallenge, RedirectUrl, Scope, TokenResponse,
};
use url::Url;

const ISSUER: &str = "https://accounts.google.com";

/// What we learn about the person once Google has confirmed who they are.
#[derive(Debug, Clone)]
pub struct GoogleIdentity {
    /// The raw ID token, to be exchanged with Supabase. Not stored anywhere.
    pub id_token: String,
    /// The raw nonce we generated. Its SHA-256 is in the token; Supabase
    /// needs the raw value to accept the token.
    pub nonce: String,
    pub subject: String,
    pub email: Option<String>,
    pub name: Option<String>,
}

pub struct GoogleSignIn {
    client_id: String,
    /// Google issues a "secret" even for Desktop clients and documents that
    /// it is not actually secret there. Kept optional so we can find out
    /// whether the token endpoint insists on it (see #26).
    client_secret: Option<String>,
    /// How long to wait for the browser to come back.
    timeout: Duration,
}

impl GoogleSignIn {
    pub fn new(client_id: impl Into<String>) -> Self {
        Self { client_id: client_id.into(), client_secret: None, timeout: Duration::from_secs(300) }
    }

    pub fn with_client_secret(mut self, secret: Option<String>) -> Self {
        self.client_secret = secret.filter(|s| !s.is_empty());
        self
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Runs the whole flow. `open_browser` is called once with the URL the
    /// person has to visit; the caller decides how to open it (the Tauri
    /// opener plugin in the app, the `open` crate in the probe).
    pub fn run(&self, open_browser: impl FnOnce(&Url) -> Result<()>) -> Result<GoogleIdentity> {
        let http = HttpClient::builder()
            .redirect(openidconnect::reqwest::redirect::Policy::none())
            .build()
            .context("building http client")?;

        let metadata = CoreProviderMetadata::discover(
            &IssuerUrl::new(ISSUER.to_string())?,
            &http,
        )
        .context("discovering Google's OpenID configuration")?;

        // Bind first so the redirect URI carries the real port.
        let listener =
            TcpListener::bind("127.0.0.1:0").context("binding a loopback port")?;
        let port = listener.local_addr()?.port();
        let redirect = format!("http://127.0.0.1:{port}");

        let client = CoreClient::from_provider_metadata(
            metadata,
            ClientId::new(self.client_id.clone()),
            self.client_secret.clone().map(ClientSecret::new),
        )
        .set_redirect_uri(RedirectUrl::new(redirect)?);

        let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
        // Supabase compares the SHA-256 of the nonce we give it against the
        // nonce claim in the ID token (verified 2026-09-22: sending the raw
        // value both ways fails with "Nonces mismatch"). So Google gets the
        // hash and Supabase gets the raw value.
        let raw_nonce = Nonce::new_random();
        let hashed_nonce = Nonce::new(sha256_hex(raw_nonce.secret()));
        let (auth_url, csrf, nonce) = client
            .authorize_url(CoreAuthenticationFlow::AuthorizationCode, CsrfToken::new_random, || hashed_nonce)
            .add_scope(Scope::new("email".into()))
            .add_scope(Scope::new("profile".into()))
            .set_pkce_challenge(pkce_challenge)
            .url();

        open_browser(&auth_url)?;

        let callback = wait_for_callback(listener, self.timeout)?;
        if callback.state != *csrf.secret() {
            bail!("the browser came back with a state we did not send");
        }

        let token = client
            .exchange_code(AuthorizationCode::new(callback.code))
            .context("Google's token endpoint is not configured")?
            .set_pkce_verifier(pkce_verifier)
            .request(&http)
            .context("exchanging the code for tokens")?;

        let id_token = token.id_token().ok_or_else(|| anyhow!("Google returned no ID token"))?;
        let claims = id_token
            .claims(&client.id_token_verifier(), &nonce)
            .context("verifying the ID token")?;

        // Google's access token is not needed for anything; drop it here.
        let _ = token.access_token();

        Ok(GoogleIdentity {
            id_token: id_token.to_string(),
            nonce: raw_nonce.secret().clone(),
            subject: claims.subject().to_string(),
            email: claims.email().map(|e| e.to_string()),
            name: claims
                .name()
                .and_then(|n| n.get(None))
                .map(|n| n.to_string()),
        })
    }
}

fn sha256_hex(input: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(input.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Debug)]
struct Callback {
    code: String,
    state: String,
}

/// Accepts requests on the loopback listener until one carries the
/// authorization response. Anything else (favicon requests, a stray tab)
/// gets a 404 and we keep waiting. Accepting happens on its own thread so
/// the timeout does not depend on non-blocking sockets, which behave
/// differently across platforms.
fn wait_for_callback(listener: TcpListener, timeout: Duration) -> Result<Callback> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let outcome = stream.map_err(Into::into).and_then(handle_request);
            match outcome {
                Ok(None) => continue,
                Ok(Some(cb)) => {
                    let _ = tx.send(Ok(cb));
                    return;
                }
                Err(e) => {
                    let _ = tx.send(Err(e));
                    return;
                }
            }
        }
    });
    match rx.recv_timeout(timeout) {
        Ok(result) => result,
        Err(_) => bail!("timed out waiting for the browser"),
    }
}

fn handle_request(mut stream: TcpStream) -> Result<Option<Callback>> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    // Drain headers up to the blank line so the browser sees a clean close.
    // Do not read past it: a GET has no body, and on macOS a read that hits
    // the socket timeout surfaces as EAGAIN rather than a clean timeout.
    let mut line = String::new();
    loop {
        line.clear();
        let n = reader.read_line(&mut line)?;
        if n == 0 || line.trim_end_matches(['\r', '\n']).is_empty() {
            break;
        }
    }

    let path = request_line.split_whitespace().nth(1).unwrap_or("/");
    let url = Url::parse(&format!("http://127.0.0.1{path}"))?;
    let mut code = None;
    let mut state = None;
    let mut error = None;
    for (k, v) in url.query_pairs() {
        match &*k {
            "code" => code = Some(v.into_owned()),
            "state" => state = Some(v.into_owned()),
            "error" => error = Some(v.into_owned()),
            _ => {}
        }
    }

    if let Some(err) = error {
        respond(&mut stream, 200, &page("Sign-in was cancelled", "You can close this window."))?;
        bail!("Google reported: {err}");
    }
    match (code, state) {
        (Some(code), Some(state)) => {
            respond(&mut stream, 200, &page("Signed in to Lita", "You can close this window and go back to Lita."))?;
            Ok(Some(Callback { code, state }))
        }
        _ => {
            respond(&mut stream, 404, "")?;
            Ok(None)
        }
    }
}

fn respond(stream: &mut TcpStream, status: u16, body: &str) -> Result<()> {
    let reason = if status == 200 { "OK" } else { "Not Found" };
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )?;
    stream.flush()?;
    Ok(())
}

fn page(title: &str, text: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title>\
         <style>body{{font-family:system-ui;margin:4rem auto;max-width:32rem;text-align:center}}</style></head>\
         <body><h1>{title}</h1><p>{text}</p></body></html>"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn request(port: u16, path: &str) -> String {
        let mut c = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(c, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: */*\r\n\r\n").unwrap();
        let mut out = String::new();
        c.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn callback_is_parsed_and_stray_requests_are_ignored() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let waiter = std::thread::spawn(move || wait_for_callback(listener, Duration::from_secs(5)));

        let stray = request(port, "/favicon.ico");
        assert!(stray.starts_with("HTTP/1.1 404"), "{stray}");

        let ok = request(port, "/?state=abc&code=4%2Fxyz&scope=email");
        assert!(ok.starts_with("HTTP/1.1 200"), "{ok}");
        assert!(ok.contains("Signed in to Lita"));

        let cb = waiter.join().unwrap().unwrap();
        assert_eq!(cb.code, "4/xyz");
        assert_eq!(cb.state, "abc");
    }

    #[test]
    fn google_error_is_reported() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let waiter = std::thread::spawn(move || wait_for_callback(listener, Duration::from_secs(5)));
        let page = request(port, "/?error=access_denied&state=abc");
        assert!(page.contains("cancelled"));
        let err = waiter.join().unwrap().unwrap_err();
        assert!(err.to_string().contains("access_denied"), "{err}");
    }

    #[test]
    fn sha256_hex_matches_known_vector() {
        assert_eq!(
            sha256_hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn waiting_times_out() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let err = wait_for_callback(listener, Duration::from_millis(100)).unwrap_err();
        assert!(err.to_string().contains("timed out"));
    }
}
