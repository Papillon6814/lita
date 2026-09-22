//! The loopback listener both sign-in flows share: one HTTP request on
//! `127.0.0.1:<random port>`, parsed for `code` and `state`.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

use anyhow::{Result, bail};
use url::Url;

#[derive(Debug)]
pub(crate) struct Callback {
    pub code: String,
    #[allow(dead_code)]
    pub state: String,
}

/// Accepts requests on the loopback listener until one carries the
/// authorization response. Anything else (favicon requests, a stray tab)
/// gets a 404 and we keep waiting. Accepting happens on its own thread so
/// the timeout does not depend on non-blocking sockets, which behave
/// differently across platforms.
#[cfg(test)]
pub(crate) fn wait_for_callback(listener: TcpListener, timeout: Duration) -> Result<Callback> {
    wait_for_callback_cancellable(listener, timeout, &std::sync::atomic::AtomicBool::new(false))
}

/// As above, but gives up as soon as `cancel` is set.
pub(crate) fn wait_for_callback_cancellable(
    listener: TcpListener,
    timeout: Duration,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<Callback> {
    use std::sync::atomic::Ordering;
    use std::sync::mpsc::RecvTimeoutError;
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
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if cancel.load(Ordering::Relaxed) {
            bail!("sign-in was cancelled");
        }
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(result) => return result,
            Err(RecvTimeoutError::Timeout) if std::time::Instant::now() < deadline => continue,
            Err(_) => bail!("timed out waiting for the browser"),
        }
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
    // `state` is optional: Supabase's PKCE redirect carries only `code`
    // (the verifier is what binds the response to this attempt).
    match code {
        Some(code) => {
            respond(&mut stream, 200, &page("Signed in to Lita", "You can close this window and go back to Lita."))?;
            Ok(Some(Callback { code, state: state.unwrap_or_default() }))
        }
        None => {
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

        let no_code = request(port, "/?state=only");
        assert!(no_code.starts_with("HTTP/1.1 404"), "{no_code}");

        let ok = request(port, "/?state=abc&code=4%2Fxyz&scope=email");
        assert!(ok.starts_with("HTTP/1.1 200"), "{ok}");
        assert!(ok.contains("Signed in to Lita"));

        let cb = waiter.join().unwrap().unwrap();
        assert_eq!(cb.code, "4/xyz");
        assert_eq!(cb.state, "abc");
    }

    #[test]
    fn code_without_state_is_accepted() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let waiter = std::thread::spawn(move || wait_for_callback(listener, Duration::from_secs(5)));
        request(port, "/?code=35702956-4a58");
        let cb = waiter.join().unwrap().unwrap();
        assert_eq!(cb.code, "35702956-4a58");
        assert_eq!(cb.state, "");
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
    fn waiting_can_be_cancelled() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let c2 = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(150));
            c2.store(true, Ordering::Relaxed);
        });
        let err = wait_for_callback_cancellable(listener, Duration::from_secs(5), &cancel).unwrap_err();
        assert!(err.to_string().contains("cancelled"), "{err}");
    }

    #[test]
    fn waiting_times_out() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let err = wait_for_callback(listener, Duration::from_millis(100)).unwrap_err();
        assert!(err.to_string().contains("timed out"));
    }
}
