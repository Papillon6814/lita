//! Medium: the public RSS feed, which carries full bodies in
//! `content:encoded` but only the latest ten posts (verified 2026-09-22).

use anyhow::{Context, Result, bail};

use crate::{Piece, html};

/// Fetches `@handle`'s feed and returns its posts as plain text.
pub fn import(handle: &str) -> Result<Vec<Piece>> {
    let handle = normalize(handle)?;
    let http = crate::http()?;
    let resp = http.get(format!("https://medium.com/feed/@{handle}")).send().context("reaching Medium")?;
    if resp.status().as_u16() == 404 {
        bail!("no Medium account called \"@{handle}\"");
    }
    let xml = resp.error_for_status()?.text()?;
    parse_feed(&xml)
}

/// Parses an RSS 2.0 feed with `content:encoded` bodies.
pub fn parse_feed(xml: &str) -> Result<Vec<Piece>> {
    let doc = roxmltree::Document::parse(xml).context("reading the feed")?;
    let mut pieces = Vec::new();
    for item in doc.descendants().filter(|n| n.has_tag_name("item")) {
        let text_of = |tag: &str| -> Option<String> {
            item.children()
                .find(|c| c.has_tag_name(tag))
                .and_then(|c| c.text())
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
        };
        let body = text_of("encoded").or_else(|| text_of("description")).unwrap_or_default();
        let text = html::to_text(&body);
        if text.trim().is_empty() {
            continue;
        }
        pieces.push(Piece { title: text_of("title"), url: text_of("link"), published_at: text_of("pubDate"), text });
    }
    Ok(pieces)
}

/// Accepts `handle`, `@handle`, or a profile URL.
pub fn normalize(input: &str) -> Result<String> {
    let s = input.trim();
    let s = s
        .strip_prefix("https://medium.com/")
        .or_else(|| s.strip_prefix("http://medium.com/"))
        .or_else(|| s.strip_prefix("medium.com/"))
        .unwrap_or(s);
    let name = s.trim_start_matches('@').split(['/', '?', '#']).next().unwrap_or("").trim();
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-') {
        bail!("\"{input}\" does not look like a Medium account");
    }
    Ok(name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_items_with_encoded_bodies() {
        let xml = include_str!("../tests/fixtures/medium.xml");
        let pieces = parse_feed(xml).unwrap();
        assert_eq!(pieces.len(), 2);
        assert_eq!(pieces[0].title.as_deref(), Some("First post"));
        assert_eq!(pieces[0].url.as_deref(), Some("https://medium.com/@someone/first-post-1"));
        assert!(pieces[0].text.contains("Hello, this is the body."), "{}", pieces[0].text);
        assert!(!pieces[0].text.contains("<p>"));
    }

    #[test]
    fn normalize_accepts_handles_and_urls() {
        assert_eq!(normalize("@someone").unwrap(), "someone");
        assert_eq!(normalize("https://medium.com/@someone/").unwrap(), "someone");
        assert!(normalize("").is_err());
    }
}
