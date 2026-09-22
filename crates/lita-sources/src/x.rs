//! X: the official data archive. `data/tweets.js` is a JavaScript file,
//! `window.YTD.tweets.part0 = [ ... ]`, holding every post as JSON.
//! Reads through the API are paid, so this file is the route.

use anyhow::{Context, Result, bail};
use serde::Deserialize;

use crate::Piece;

#[derive(Deserialize)]
struct Entry {
    tweet: Tweet,
}

#[derive(Deserialize)]
struct Tweet {
    id_str: String,
    full_text: String,
    created_at: Option<String>,
    in_reply_to_user_id_str: Option<String>,
    #[serde(default)]
    entities: Entities,
}

#[derive(Deserialize, Default)]
struct Entities {
    #[serde(default)]
    urls: Vec<UrlEntity>,
}

#[derive(Deserialize)]
struct UrlEntity {
    url: String,
    expanded_url: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct Options {
    /// Replies are usually half of a conversation; off by default.
    pub include_replies: bool,
    /// Posts shorter than this (after cleanup) are dropped.
    pub min_chars: usize,
}

impl Default for Options {
    fn default() -> Self {
        Self { include_replies: false, min_chars: 20 }
    }
}

/// Parses `tweets.js` (or the bare JSON array) into pieces, newest first.
/// Retweets are always dropped: they are someone else's words.
pub fn parse_tweets_js(input: &str, handle: Option<&str>, opts: Options) -> Result<Vec<Piece>> {
    let start = input.find('[').context("tweets.js does not contain a JSON array")?;
    let json = input[start..].trim_end().trim_end_matches(';');
    let entries: Vec<Entry> = serde_json::from_str(json).context("reading tweets.js")?;
    if entries.is_empty() {
        bail!("the archive has no posts");
    }
    let mut pieces: Vec<Piece> = entries
        .into_iter()
        .filter(|e| !e.tweet.full_text.starts_with("RT @"))
        .filter(|e| opts.include_replies || e.tweet.in_reply_to_user_id_str.is_none())
        .filter_map(|e| {
            let text = clean(&e.tweet);
            if text.chars().count() < opts.min_chars {
                return None;
            }
            let url = handle.map(|h| format!("https://x.com/{}/status/{}", h.trim_start_matches('@'), e.tweet.id_str));
            Some(Piece { title: None, url, published_at: e.tweet.created_at, text })
        })
        .collect();
    // Archives are not reliably ordered; newest first by id (ids are time-ordered).
    pieces.reverse();
    Ok(pieces)
}

/// Expands t.co links, drops media links, and unescapes the few entities
/// the archive HTML-encodes.
fn clean(t: &Tweet) -> String {
    let mut text = t.full_text.clone();
    for u in &t.entities.urls {
        match &u.expanded_url {
            Some(expanded) => text = text.replace(&u.url, expanded),
            None => text = text.replace(&u.url, ""),
        }
    }
    // Media links are not in `entities.urls`; they remain as t.co and carry
    // no voice.
    let text: String = text
        .split_whitespace()
        .filter(|w| !w.starts_with("https://t.co/"))
        .collect::<Vec<_>>()
        .join(" ");
    text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"window.YTD.tweets.part0 = [
  { "tweet": { "id_str": "1", "full_text": "RT @someone: not mine at all, definitely not", "created_at": "Mon Sep 01 00:00:00 +0000 2026" } },
  { "tweet": { "id_str": "2", "full_text": "@friend yes, agreed on all of that", "in_reply_to_user_id_str": "99", "created_at": "Mon Sep 01 00:00:01 +0000 2026" } },
  { "tweet": { "id_str": "3", "full_text": "short", "created_at": "Mon Sep 01 00:00:02 +0000 2026" } },
  { "tweet": { "id_str": "4", "full_text": "新機能を出しました。詳しくは https://t.co/abc &amp; 画像 https://t.co/img", "created_at": "Mon Sep 01 00:00:03 +0000 2026",
    "entities": { "urls": [ { "url": "https://t.co/abc", "expanded_url": "https://example.com/launch" } ] } } }
];"#;

    #[test]
    fn keeps_own_posts_only_and_cleans_links() {
        let pieces = parse_tweets_js(FIXTURE, Some("@me"), Options::default()).unwrap();
        assert_eq!(pieces.len(), 1);
        assert_eq!(pieces[0].text, "新機能を出しました。詳しくは https://example.com/launch & 画像");
        assert_eq!(pieces[0].url.as_deref(), Some("https://x.com/me/status/4"));
    }

    #[test]
    fn replies_can_be_included() {
        let pieces = parse_tweets_js(FIXTURE, None, Options { include_replies: true, min_chars: 5 }).unwrap();
        assert_eq!(pieces.len(), 3);
        assert_eq!(pieces[0].text, "新機能を出しました。詳しくは https://example.com/launch & 画像");
    }

    #[test]
    fn rejects_non_archives() {
        assert!(parse_tweets_js("hello", None, Options::default()).is_err());
        assert!(parse_tweets_js("[]", None, Options::default()).is_err());
    }
}
