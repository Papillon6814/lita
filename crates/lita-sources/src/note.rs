//! note.com: a creator's public, free text notes through the public JSON
//! API the site itself uses. Verified 2026-09-22: `/api/v2/creators/{name}/
//! contents?kind=note&page=N` lists six notes per page with `totalCount`
//! and `isLastPage`; `/api/v3/notes/{key}` returns the body as HTML.

use anyhow::{Context, Result, bail};
use serde::Deserialize;

use crate::{Piece, html};

const BASE: &str = "https://note.com/api";

#[derive(Deserialize)]
struct ListResponse {
    data: ListData,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListData {
    contents: Vec<ListItem>,
    is_last_page: bool,
    #[serde(default)]
    total_count: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListItem {
    key: String,
    name: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    price: i64,
    publish_at: Option<String>,
    note_url: Option<String>,
    /// Present in the list; may be the full body or a preview.
    body: Option<String>,
}

#[derive(Deserialize)]
struct NoteResponse {
    data: NoteData,
}

#[derive(Deserialize)]
struct NoteData {
    body: Option<String>,
}

/// What a listing found before bodies were fetched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Listing {
    /// Free text notes, newest first.
    pub notes: Vec<Summary>,
    /// Everything the creator has published, paid and otherwise.
    pub total_count: u64,
    pub skipped_paid: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Summary {
    pub key: String,
    pub title: String,
    pub url: Option<String>,
    pub published_at: Option<String>,
}

/// Lists a creator's free text notes, newest first, up to `max`.
pub fn list(urlname: &str, max: usize) -> Result<Listing> {
    let urlname = normalize(urlname)?;
    let http = crate::http()?;
    let mut notes = Vec::new();
    let mut skipped_paid = 0;
    let mut total_count = 0;
    for page in 1..=200 {
        let url = format!("{BASE}/v2/creators/{urlname}/contents?kind=note&page={page}");
        let resp = http.get(&url).send().context("reaching note.com")?;
        if resp.status().as_u16() == 404 {
            bail!("no note creator called \"{urlname}\"");
        }
        let list: ListResponse = resp.error_for_status()?.json().context("reading note's listing")?;
        total_count = list.data.total_count;
        for item in list.data.contents {
            if item.kind != "TextNote" {
                continue;
            }
            if item.price > 0 {
                skipped_paid += 1;
                continue;
            }
            notes.push(Summary { key: item.key, title: item.name, url: item.note_url, published_at: item.publish_at });
            if notes.len() >= max {
                return Ok(Listing { notes, total_count, skipped_paid });
            }
        }
        if list.data.is_last_page {
            break;
        }
    }
    Ok(Listing { notes, total_count, skipped_paid })
}

/// Fetches one note's body as plain text.
pub fn fetch(summary: &Summary) -> Result<Piece> {
    let http = crate::http()?;
    let url = format!("{BASE}/v3/notes/{}", summary.key);
    let note: NoteResponse = http.get(&url).send()?.error_for_status()?.json().context("reading a note")?;
    Ok(Piece {
        title: Some(summary.title.clone()),
        url: summary.url.clone(),
        published_at: summary.published_at.clone(),
        text: html::to_text(note.data.body.as_deref().unwrap_or_default()),
    })
}

/// Lists and fetches in one go, pausing briefly between bodies so a
/// twenty-article import does not look like a scrape.
pub fn import(urlname: &str, max: usize) -> Result<(Listing, Vec<Piece>)> {
    let listing = list(urlname, max)?;
    let mut pieces = Vec::with_capacity(listing.notes.len());
    for (i, s) in listing.notes.iter().enumerate() {
        if i > 0 {
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        let piece = fetch(s)?;
        if !piece.text.trim().is_empty() {
            pieces.push(piece);
        }
    }
    Ok((listing, pieces))
}

/// Accepts `name`, `@name`, or a profile URL and returns the urlname.
pub fn normalize(input: &str) -> Result<String> {
    let s = input.trim().trim_start_matches('@');
    let s = s
        .strip_prefix("https://note.com/")
        .or_else(|| s.strip_prefix("http://note.com/"))
        .or_else(|| s.strip_prefix("note.com/"))
        .unwrap_or(s);
    let name = s.split(['/', '?', '#']).next().unwrap_or("").trim();
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        bail!("\"{input}\" does not look like a note account");
    }
    Ok(name.to_string())
}

// Unused field kept for the type to match the API; silence the warning.
#[allow(dead_code)]
fn _touch(item: &ListItem) -> Option<&String> {
    item.body.as_ref()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_accepts_names_handles_and_urls() {
        assert_eq!(normalize("kensuu").unwrap(), "kensuu");
        assert_eq!(normalize("@kensuu ").unwrap(), "kensuu");
        assert_eq!(normalize("https://note.com/kensuu/n/abc").unwrap(), "kensuu");
        assert_eq!(normalize("note.com/kensuu?x=1").unwrap(), "kensuu");
        assert!(normalize("").is_err());
        assert!(normalize("https://example.com/kensuu").is_err());
    }
}
