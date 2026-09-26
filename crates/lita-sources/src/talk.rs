//! A conversation pasted from any chat or mail (D-77): who said what, so that
//! only the person's own messages are kept.
//!
//! Nothing here knows which tool the text came from. It looks for one shape,
//! "a name (and a time) on a line of its own, then what was said", in its
//! different spellings: `Name  10:23`, `Name [10:23 AM]`, a name line with a
//! time line under it, `Name — Today 10:23`, `[9/26 10:23] Name`,
//! `10:23<TAB>Name<TAB>text`, `[10:23] Name: text`, `Name: text`, and the
//! "… wrote:" line above a quoted mail. Everything the pattern needs is in
//! the `Cues` below, so a chat that changes its screen is fixed in one place.
//!
//! Other people's messages are read here and handed back only so that the
//! person can choose who they are without pasting again; the caller keeps
//! them in memory and drops them. Nothing is stored and nothing goes to Codex
//! from this module.

use std::collections::HashSet;
use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

/// One message, reduced to what the person wrote.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Message {
    /// `None`: text with no name above it (the top of a mail reply, or a
    /// chat that does not name your own messages).
    pub speaker: Option<String>,
    /// Headers, screen text, mentions, links, emoji codes, quotes and code
    /// blocks removed. Never contains a blank line.
    pub body: String,
    /// The same text was already added from a conversation before, or came
    /// earlier in this paste from the same speaker.
    pub seen: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Reading {
    /// Not a conversation: pasted writing, handled as before.
    Plain,
    /// Times recur, but no names could be told apart. Handled as plain,
    /// with one sentence saying so.
    Unsure,
    Talk {
        /// Named speakers in order of first appearance. A name can be here
        /// with no message left (only a sticker, say).
        speakers: Vec<String>,
        /// Every message with text left, in order.
        messages: Vec<Message>,
    },
}

/// Reads `text`. `known` are bodies already added from conversations (each
/// one message per paragraph), so the same message is marked `seen`.
pub fn read(text: &str, known: &[String]) -> Reading {
    let lines: Vec<String> = normalise(text).lines().map(|l| l.trim().to_string()).collect();
    let mut kinds = classify(&lines);
    resolve_colons(&mut kinds);

    let named = kinds.iter().filter(|k| matches!(k, Kind::Header { .. })).count();
    let stamps = kinds.iter().filter(|k| matches!(k, Kind::Stamp { clock: true, .. })).count();
    let intros = kinds.iter().filter(|k| matches!(k, Kind::Intro)).count();
    let talk = named >= 2 || (named >= 1 && named + stamps >= 2) || intros >= 1;
    if !talk {
        let timed = stamps + named + kinds.iter().filter(|k| matches!(k, Kind::Text(t) if CUES.time_lead.is_match(t))).count();
        return if timed >= 2 { Reading::Unsure } else { Reading::Plain };
    }

    let mut speakers: Vec<String> = Vec::new();
    for k in &kinds {
        if let Kind::Header { name, .. } = k
            && !speakers.contains(name) {
                speakers.push(name.clone());
            }
    }
    let raw = gather(kinds);
    let known: HashSet<String> = known.iter().flat_map(|k| paragraphs(k)).map(|p| key(&p)).collect();
    let mut here: HashSet<(Option<String>, String)> = HashSet::new();
    let mut messages = Vec::new();
    for (speaker, lines) in raw {
        let body = clean(&lines, &speakers);
        if body.is_empty() {
            continue;
        }
        let k = key(&body);
        let seen = known.contains(&k) || !here.insert((speaker.clone(), k));
        messages.push(Message { speaker, body, seen });
    }
    Reading::Talk { speakers, messages }
}

// ----- the cues: every pattern the reading relies on ---------------------

struct Cues {
    /// A line that is only a time and/or date: `10:23`, `午前 10:23`,
    /// `Today at 10:23 AM`, `2026/09/26(土)`, `[9/26 10:23]`, `10:23 (2 時間前)`.
    stamp_line: Regex,
    /// Whether a stamp says more than a bare clock (a date, a day, AM/PM).
    strong_stamp: Regex,
    /// Whether a stamp has a clock in it (a date divider does not).
    clock: Regex,
    /// `Name  10:23`, `Name [10:23 AM]`, `Name — Today 10:23`, `Name, 10:23`.
    name_stamp: Regex,
    /// `[9/26 10:23] Name` (the stamp must carry a date or a day).
    stamp_name: Regex,
    /// `[10:23] Name: text` or `10:23 Name: text`.
    stamp_colon: Regex,
    /// `10:23<TAB>Name<TAB>text` (a saved LINE history).
    tab_line: Regex,
    /// `[10:24]text`: the same person again.
    stamp_text: Regex,
    /// `Name: text` / `Name<TAB>text`, a conversation only when it recurs.
    colon: Regex,
    tab_pair: Regex,
    /// A line that starts with a clock, for "times recur" alone.
    time_lead: Regex,
    /// Above a quoted mail: `… wrote:`, `… のメッセージ:`, `… <a@b.c>:`, `-----Original Message-----`.
    intro: Vec<Regex>,
    /// `From:` followed by `Sent:` / `Date:`: an unquoted forwarded mail.
    from: Regex,
    sent: Regex,
    /// The line before a wrapped `… <\naddr> wrote:`.
    intro_head: Regex,
    signature: Regex,
    /// Screen text, reactions, attachments, system lines, in Japanese and English.
    chrome: Vec<Regex>,
    /// Lines under a mail header: `To 佐藤`, `宛先: …`, `to me`.
    head_chrome: Regex,
    /// Inline removals inside a kept message.
    slack_link: Regex,
    md_link: Regex,
    angle_url: Regex,
    url: Regex,
    slack_mention: Regex,
    mention: Regex,
    emoji_code: Regex,
    edited: Regex,
    code_block: Regex,
    email: Regex,
    spaces: Regex,
}

static CUES: LazyLock<Cues> = LazyLock::new(|| {
    let month = r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?";
    let weekday = r"(?:(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)[a-z]*\.?|[(（][月火水木金土日](?:曜日?)?[)）]|[月火水木金土日]曜日)";
    let clock = r"(?:(?:午前|午後)\s*)?\d{1,2}[:：]\d{2}(?:[:：]\d{2})?(?:\s*[AaPp]\.?[Mm]\.?)?";
    let day = r"(?:今日|昨日|一昨日|おととい|Today|Yesterday|today|yesterday)";
    let date = format!(
        r"(?:\d{{4}}[/.\-]\d{{1,2}}[/.\-]\d{{1,2}}|\d{{4}}年\s*\d{{1,2}}月\s*\d{{1,2}}日|\d{{1,2}}月\s*\d{{1,2}}日|\d{{1,2}}/\d{{1,2}}(?:/\d{{2,4}})?|{month}\s+\d{{1,2}}(?:st|nd|rd|th)?(?:,?\s+\d{{4}})?|\d{{1,2}}\s+{month}(?:\s+\d{{4}})?)"
    );
    let part = format!(r"(?:{day}|{date}|{clock}|{weekday})");
    let stamp = format!(r"{part}(?:\s*,?\s*(?:(?:at|の)\s*)?{part})*");
    let after = r"(?:\s*[(（][^)）]{1,24}[)）])?";
    let re = |s: &str| Regex::new(s).expect("talk cue");
    Cues {
        stamp_line: re(&format!(r"^\[?\s*{stamp}\s*\]?{after}$")),
        strong_stamp: re(&format!(r"{day}|{date}|[AaPp]\.?[Mm]\.?$|午前|午後|{weekday}")),
        clock: re(r"\d{1,2}[:：]\d{2}"),
        name_stamp: re(&format!(r"^(?P<name>.+?)(?P<sep>\s*[—–|・,]\s*|\s+)(?P<open>\[)?(?P<stamp>{stamp})\]?{after}$")),
        stamp_name: re(&format!(r"^\[(?P<stamp>{stamp})\]\s*(?P<name>[^:：\t\[\]]+?)$")),
        stamp_colon: re(&format!(r"^\[?(?P<stamp>{stamp})\]?\s+(?P<name>[^:：\t\[\]]{{1,30}}?)\s*[:：]\s*(?P<body>.*)$")),
        tab_line: re(&format!(r"^(?P<stamp>{clock})\t(?P<name>[^\t]{{1,40}})\t(?P<body>.*)$")),
        stamp_text: re(&format!(r"^\[(?P<stamp>{clock})\]\s*(?P<body>.+)$")),
        colon: re(r"^(?P<name>[^:：\s>][^:：]{0,23}?)\s*[:：]\s*(?P<body>.*)$"),
        tab_pair: re(r"^(?P<name>[^\t]{1,24})\t(?P<body>.+)$"),
        time_lead: re(&format!(r"^\[?{clock}\]?\s+\S")),
        intro: vec![
            re(r"(?i)\bwrote\s*:\s*$"),
            re(r"(?:のメッセージ|が書きました|は書きました|書き込みました)\s*[:：]\s*$"),
            re(r"<[^<>\s]+@[^<>\s]+>\s*[:：]\s*$"),
            re(r"(?i)^-{2,}\s*(?:original message|forwarded message|元のメッセージ|転送されたメッセージ)\s*-{2,}$"),
        ],
        from: re(r"^(?:From|差出人)\s*[:：]\s*\S"),
        sent: re(r"^(?:Sent|Date|送信日時|日付)\s*[:：]"),
        intro_head: re(r"(?i)^(?:on\s|\d{4}年|\d{4}/)"),
        signature: re(r"^--\s*$"),
        chrome: [
            r"^\d+\s*件の返信$",
            r"(?i)^\d+\s+repl(?:y|ies)$",
            r"(?i)^(?:最終返信|last reply)\b.*$",
            r"(?i)^(?:view thread|スレッドを表示|スレッドに返信|スレッドで返信|reply in thread|reply|返信|返信する)$",
            r"(?i)^(?:also sent to the channel|チャンネルにも投稿済み|チャンネルにも送信済み|チャンネルにも投稿されました)$",
            r"(?i)^(?:new|new messages?|新規|新着メッセージ|未読)$",
            r"(?i)^(?:show more|show less|see more|さらに表示|表示を減らす|もっと見る|続きを読む|メッセージを表示|view message|view conversation|会話を表示)$",
            r"(?i)^(?:this message was deleted\.?|このメッセージは削除されました。?|メッセージの送信を取り消しました|.*unsent a message\.?)$",
            r"(?i)^.*\b(?:joined|left)\s+(?:#\S+|the channel)\.?$",
            r"^.*(?:さん)?が(?:チャンネル|グループ)に参加しました。?$",
            r"(?i)^(?:posted in|投稿先)\s.*$",
            r"(?i)^(?:pinned by|ピン留め).*$",
            r"(?i)^(?:\(edited\)|（編集済み）|\(編集済み\)|edited|編集済み)$",
            r"(?i)^(?:seen by|既読).*$",
            r"^\d+$",
            r"(?i)^\[(?:スタンプ|写真|動画|ファイル|アルバム|ボイスメッセージ|通話|位置情報|連絡先|sticker|photo|video|file|album|voice message|call|location|contact)[^\]]{0,20}\]$",
            r"(?i)^\[LINE\]\s.*$",
            r"(?i)^(?:保存日時|saved on)\s*[:：].*$",
            r"(?i)^[^\s/]+\.(?:pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|heic|zip|csv|txt|key|numbers|pages|mp4|mov)$",
            r"(?i)^(?:www\.)?[a-z0-9\-]+(?:\.[a-z0-9\-]+)*\.[a-z]{2,}$",
        ]
        .iter()
        .map(|s| re(s))
        .collect(),
        head_chrome: re(r"(?i)^(?:(?:to|cc|bcc|宛先|cc)\s*[:：]?\s+\S.{0,60}|to me|自分宛て?)$"),
        slack_link: re(r"<https?://[^|>\s]+\|([^>]+)>"),
        md_link: re(r"\[([^\]]+)\]\(https?://[^)\s]+\)"),
        angle_url: re(r"<https?://[^>\s]+>"),
        url: re(r"https?://\S+"),
        slack_mention: re(r"<[@#!][A-Za-z0-9^]+(?:\|[^>]*)?>"),
        mention: re(r"[@＠][^\s@＠、。,.!?！？()（）]+"),
        emoji_code: re(r":(?:[a-z0-9_+\-]*[a-z][a-z0-9_+\-]*|[+\-]1):"),
        edited: re(r"\s*[(（](?:edited|編集済み|編集済)[)）]"),
        code_block: re(r"(?s)```.*?```"),
        email: re(r"\s*<[^<>\s]+@[^<>\s]+>"),
        spaces: re(r"[ \t]{2,}"),
    }
});

// ----- reading line by line ----------------------------------------------

#[derive(Debug)]
enum Kind {
    Blank,
    /// A name heads what follows. `body` is text on the same line.
    Header { name: String, body: Option<String> },
    /// A time (or a date) alone, or `[10:24]text`: the same person goes on.
    Stamp { clock: bool, body: Option<String> },
    /// `Name: text` that only counts when it recurs; `line` is kept to fall back on.
    Colon { name: String, body: String, line: String },
    /// The line above a quoted mail: what follows is someone else's.
    Intro,
    Signature,
    Quote,
    Chrome,
    Text(String),
}

fn classify(lines: &[String]) -> Vec<Kind> {
    let c = &*CUES;
    let mut out = Vec::with_capacity(lines.len());
    // Right after a name (or a time), the next line is what was said, never
    // another name: "了解です" followed by "10:24" is a message and its
    // continuation, not a person called 了解です.
    let mut after_head = false;
    let mut i = 0;
    while i < lines.len() {
        let l = lines[i].as_str();
        let next = lines.get(i + 1).map(String::as_str).unwrap_or("");
        let kind = if l.is_empty() {
            Kind::Blank
        } else if l.starts_with('>') || l.starts_with('＞') {
            Kind::Quote
        } else if c.intro.iter().any(|r| r.is_match(l)) || (c.from.is_match(l) && c.sent.is_match(next)) {
            Kind::Intro
        } else if c.signature.is_match(l) {
            Kind::Signature
        } else if is_chrome(l) || (after_head && c.head_chrome.is_match(l)) {
            Kind::Chrome
        } else if let Some(k) = header_on_line(l) {
            k
        } else if !after_head && c.stamp_line.is_match(next) && c.clock.is_match(next) {
            match name(l) {
                Some(n) => {
                    i += 1;
                    Kind::Header { name: n, body: None }
                }
                None => text_or_colon(l),
            }
        } else {
            text_or_colon(l)
        };
        after_head = match &kind {
            Kind::Header { body: None, .. } | Kind::Stamp { clock: true, body: None } => true,
            Kind::Blank | Kind::Chrome => after_head,
            _ => false,
        };
        out.push(kind);
        i += 1;
    }
    out
}

/// A line that is a header (or a stamp) by itself, without looking around.
fn header_on_line(l: &str) -> Option<Kind> {
    let c = &*CUES;
    if let Some(m) = c.tab_line.captures(l)
        && let Some(n) = name(&m["name"]) {
            return Some(Kind::Header { name: n, body: Some(m["body"].to_string()) });
        }
    if c.stamp_line.is_match(l) {
        return Some(Kind::Stamp { clock: c.clock.is_match(l), body: None });
    }
    if let Some(m) = c.stamp_colon.captures(l)
        && let Some(n) = name(&m["name"]) {
            return Some(Kind::Header { name: n, body: Some(m["body"].to_string()) });
        }
    if let Some(m) = c.stamp_name.captures(l) {
        if !c.strong_stamp.is_match(&m["stamp"]) || !c.clock.is_match(&m["stamp"]) {
            // `[10:24]text` is the same person going on, not a name.
        } else if let Some(n) = name(&m["name"]) {
            return Some(Kind::Header { name: n, body: None });
        }
    }
    if let Some(m) = c.stamp_text.captures(l) {
        return Some(Kind::Stamp { clock: true, body: Some(m["body"].to_string()) });
    }
    if let Some(m) = c.name_stamp.captures(l) {
        let sep = &m["sep"];
        let stamp = &m["stamp"];
        // "集合は 10:30" is a sentence; a name sits apart from its time by a
        // mark, a bracket, two spaces, or a time that says more than a clock.
        let apart = m.name("open").is_some() || !sep.trim().is_empty() || sep.chars().count() >= 2 || sep.contains('\t') || c.strong_stamp.is_match(stamp);
        if apart && (c.clock.is_match(stamp) || c.strong_stamp.is_match(stamp))
            && let Some(n) = name(&m["name"]) {
                return Some(Kind::Header { name: n, body: None });
            }
    }
    None
}

fn text_or_colon(l: &str) -> Kind {
    let c = &*CUES;
    for r in [&c.colon, &c.tab_pair] {
        if let Some(m) = r.captures(l) {
            let n = m["name"].trim();
            let scheme = matches!(n.to_ascii_lowercase().as_str(), "http" | "https" | "mailto" | "ftp");
            if !scheme && n.chars().count() <= 20 && n.split_whitespace().count() <= 3 && !m["body"].starts_with("//")
                && let Some(n) = name(n) {
                    return Kind::Colon { name: n, body: m["body"].trim().to_string(), line: l.to_string() };
                }
        }
    }
    Kind::Text(l.to_string())
}

/// A header's name, cleaned, or `None` when the text cannot be a name.
fn name(raw: &str) -> Option<String> {
    let c = &*CUES;
    let s = c.email.replace_all(raw, "");
    let s = s.trim().trim_end_matches([':', '：', '—', '–', '-', '|', ',']).trim();
    let s = c.spaces.replace_all(s, " ").to_string();
    let n = s.chars().count();
    if n == 0 || n > 32 || s.split_whitespace().count() > 5 {
        return None;
    }
    if s.contains(['。', '．', '！', '？', '!', '?', '「', '」', '『', '』', '“', '”', '…', '、', '<', '>', '"']) || s.contains("://") {
        return None;
    }
    if s.starts_with(['-', '*', '#', '•', '・', '[', '(', '（']) || !s.chars().any(char::is_alphabetic) {
        return None;
    }
    if c.stamp_line.is_match(&s) || is_chrome(&s) {
        return None;
    }
    Some(s)
}

fn is_chrome(l: &str) -> bool {
    let c = &*CUES;
    if c.chrome.iter().any(|r| r.is_match(l)) {
        return true;
    }
    // A reaction: emoji (or `:codes:`) and counts, nothing else.
    let bare = c.emoji_code.replace_all(l, "\u{1F600}");
    let mut emoji = false;
    for ch in bare.chars() {
        if is_emoji(ch) {
            emoji = true;
        } else if !(ch.is_whitespace() || ch.is_ascii_digit()) {
            return false;
        }
    }
    emoji
}

fn is_emoji(ch: char) -> bool {
    matches!(ch as u32, 0x1F000..=0x1FAFF | 0x2600..=0x27BF | 0x2B00..=0x2BFF | 0xFE0F | 0x200D)
}

/// `Name: text` makes a conversation only when no stronger header was found
/// and it recurs: three lines or more, two names or more, one name at least
/// twice, and a fair share of the text. Otherwise the lines are prose again.
fn resolve_colons(kinds: &mut [Kind]) {
    let strong = kinds.iter().any(|k| matches!(k, Kind::Header { .. }));
    let lines = kinds.iter().filter(|k| !matches!(k, Kind::Blank)).count();
    let names: Vec<&str> = kinds.iter().filter_map(|k| if let Kind::Colon { name, .. } = k { Some(name.as_str()) } else { None }).collect();
    let distinct: HashSet<&str> = names.iter().copied().collect();
    let repeated = distinct.iter().any(|n| names.iter().filter(|x| *x == n).count() >= 2);
    let talk = !strong && names.len() >= 3 && distinct.len() >= 2 && repeated && names.len() * 4 >= lines;
    for k in kinds.iter_mut() {
        if let Kind::Colon { name, body, line } = k {
            *k = if talk {
                Kind::Header { name: std::mem::take(name), body: Some(std::mem::take(body)) }
            } else {
                Kind::Text(std::mem::take(line))
            };
        }
    }
}

/// Splits the lines into messages. A header starts one; a time alone starts
/// the same person's next one; text before any header has no name. After a
/// quote's intro or a signature, nothing is kept until the next header.
fn gather(kinds: Vec<Kind>) -> Vec<(Option<String>, Vec<String>)> {
    let c = &*CUES;
    let mut out: Vec<(Option<String>, Vec<String>)> = vec![(None, Vec::new())];
    let mut quoting = false;
    for k in kinds {
        match k {
            Kind::Header { name, body } => {
                quoting = false;
                out.push((Some(name), body.into_iter().collect()));
            }
            Kind::Stamp { body, .. } => {
                let who = out.last().and_then(|m| m.0.clone());
                if !quoting {
                    out.push((who, body.into_iter().collect()));
                }
            }
            Kind::Intro => {
                // A wrapped "On …, Name <\naddr> wrote:" leaves its first half behind.
                if let Some(last) = out.last_mut() {
                    while last.1.last().is_some_and(|l| l.is_empty()) {
                        last.1.pop();
                    }
                    if last.1.last().is_some_and(|l| c.intro_head.is_match(l)) {
                        last.1.pop();
                    }
                }
                quoting = true;
            }
            Kind::Signature => quoting = true,
            Kind::Quote | Kind::Chrome => {}
            Kind::Blank => {
                if !quoting
                    && let Some(last) = out.last_mut() {
                        last.1.push(String::new());
                    }
            }
            Kind::Text(t) => {
                if !quoting
                    && let Some(last) = out.last_mut() {
                        last.1.push(t);
                    }
            }
            Kind::Colon { line, .. } => {
                if !quoting
                    && let Some(last) = out.last_mut() {
                        last.1.push(line);
                    }
            }
        }
    }
    out
}

/// What is kept of one message: its own words, one paragraph per line.
fn clean(lines: &[String], speakers: &[String]) -> String {
    let c = &*CUES;
    let joined = lines.join("\n");
    let joined = c.code_block.replace_all(&joined, "\n");
    // A saved LINE history wraps a message of several lines in quotes.
    let trimmed = joined.trim();
    let joined = if trimmed.len() > 1 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        trimmed[1..trimmed.len() - 1].replace("\"\"", "\"")
    } else {
        trimmed.to_string()
    };
    let mut names: Vec<&String> = speakers.iter().collect();
    names.sort_by_key(|n| std::cmp::Reverse(n.chars().count()));
    let mut kept = Vec::new();
    for line in joined.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('>') || line.starts_with("```") || is_chrome(line) {
            continue;
        }
        let mut s = c.slack_link.replace_all(line, "$1").to_string();
        s = c.md_link.replace_all(&s, "$1").to_string();
        s = c.angle_url.replace_all(&s, "").to_string();
        s = c.url.replace_all(&s, "").to_string();
        s = c.slack_mention.replace_all(&s, "").to_string();
        for n in &names {
            for at in ['@', '＠'] {
                s = s.replace(&format!("{at}{n}"), "");
            }
        }
        s = c.mention.replace_all(&s, "").to_string();
        s = c.emoji_code.replace_all(&s, "").to_string();
        s = c.edited.replace_all(&s, "").to_string();
        s = c.spaces.replace_all(&s, " ").to_string();
        let s = s.trim();
        if !s.is_empty() {
            kept.push(s.to_string());
        }
    }
    kept.join("\n")
}

fn normalise(text: &str) -> String {
    text.replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace(['\u{00A0}', '\u{3000}'], " ")
        .replace(['\u{200B}', '\u{FEFF}', '\u{2028}'], "")
}

fn paragraphs(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut buf: Vec<&str> = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            if !buf.is_empty() {
                out.push(buf.join("\n"));
                buf.clear();
            }
        } else {
            buf.push(line);
        }
    }
    if !buf.is_empty() {
        out.push(buf.join("\n"));
    }
    out
}

/// Two messages are the same when only their spacing differs.
fn key(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace()).collect()
}

#[cfg(test)]
mod tests {
    //! Every sample below is invented: made-up people, made-up words. None
    //! is a real person's copy. Where a tool's copy format could not be
    //! checked against a source, the test name says `guessed`.

    use super::*;

    fn talk(r: &Reading) -> (&[String], &[Message]) {
        match r {
            Reading::Talk { speakers, messages } => (speakers, messages),
            other => panic!("expected a conversation, got {other:?}"),
        }
    }

    /// What would be saved for `me`: the unseen messages, a blank line apart.
    fn kept(r: &Reading, me: Option<&str>) -> String {
        let (_, messages) = talk(r);
        messages
            .iter()
            .filter(|m| m.speaker.as_deref() == me && !m.seen)
            .map(|m| m.body.as_str())
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    fn assert_clean(saved: &str, banned: &[&str]) {
        for b in banned {
            assert!(!saved.contains(b), "{b:?} leaked into {saved:?}");
        }
    }

    // Slack, Japanese screen: name and time on one line, a time alone for the
    // same person again, reactions, the thread line, an edit mark, a mention,
    // an emoji code and a bare link. Shape from the sources in the
    // requirement (confidence medium): not a real Slack copy.
    const SLACK_JA: &str = "今日
佐藤 花子  10:21
来週の採用面談、評価シートはどこに置いてありますか？
2 件の返信
最終返信 今日 10:40
森川 陽介  10:23
共有ドライブの「採用」フォルダに置きました。見てほしいのは点数ではなく、面談官ごとのばらつきです。 (編集済み)
10:24
@佐藤 花子 火曜までにコメントをもらえると助かります :pray:
詳しくは https://example.com/guide を見てください。
:+1:
2
佐藤 花子  10:30
承知しました。ばらつきの件、野村さんにも共有しておきます。
森川 陽介  10:32
資金繰り表は週次に切り替えました。
";

    #[test]
    fn slack_ja_keeps_only_the_chosen_persons_words() {
        let r = read(SLACK_JA, &[]);
        let (speakers, _) = talk(&r);
        assert_eq!(speakers, ["佐藤 花子", "森川 陽介"]);
        let saved = kept(&r, Some("森川 陽介"));
        assert_eq!(
            saved,
            "共有ドライブの「採用」フォルダに置きました。見てほしいのは点数ではなく、面談官ごとのばらつきです。\n\n火曜までにコメントをもらえると助かります\n詳しくは を見てください。\n\n資金繰り表は週次に切り替えました。"
        );
        assert_clean(&saved, &["佐藤", "花子", "森川", "10:", "件の返信", "最終返信", "編集済み", "野村", "置いてありますか", "承知", "pray", "+1", "https", "example", "今日"]);
    }

    // Slack, English screen: the name on one line and the time under it,
    // the name with a bracketed time, a join line and the thread lines.
    // Shape from the sources in the requirement (confidence medium).
    const SLACK_EN: &str = "Jordan Lee
10:02 AM
Did anyone look at the churn numbers from last week?
Alex Rivera
10:05 AM
I did. The drop is mostly in the annual plans, not the monthly ones. (edited)
10:06 AM
Going to write it up before Friday.
3 replies
Last reply 2 hours ago
View thread
Sam Patel  [10:11 AM]
Nice, cc @Jordan Lee
Jordan Lee joined #metrics.
Alex Rivera  [10:15 AM]
One more thing: let's set the stop rule before we start, not after. :thinking_face:
";

    #[test]
    fn slack_en_keeps_only_the_chosen_persons_words() {
        let r = read(SLACK_EN, &[]);
        let (speakers, _) = talk(&r);
        assert_eq!(speakers, ["Jordan Lee", "Alex Rivera", "Sam Patel"]);
        let saved = kept(&r, Some("Alex Rivera"));
        assert_eq!(
            saved,
            "I did. The drop is mostly in the annual plans, not the monthly ones.\n\nGoing to write it up before Friday.\n\nOne more thing: let's set the stop rule before we start, not after."
        );
        assert_clean(&saved, &["Jordan", "Sam", "Alex", "AM", "churn", "Nice", "cc", "joined", "repl", "thread", "edited", "thinking"]);
    }

    // Teams: GUESSED. No source for how Teams copies several messages could
    // be checked; this is "[date time] Name" above the text.
    const TEAMS_GUESSED: &str = "[9/26 10:21] 佐藤 花子
来週の定例、議題を先に集めませんか
[9/26 10:23] 森川 陽介
賛成です。私からは採用の進み具合を出します。
[9/26 10:25] Mika Tanaka
I'll add the budget review.
";

    // Teams, the other guessed spelling: "Name date time" on one line.
    const TEAMS_INLINE_GUESSED: &str = "佐藤 花子 9/26 10:21 AM
来週の定例、議題を先に集めませんか
森川 陽介 9/26 10:23 AM
賛成です。私からは採用の進み具合を出します。
";

    #[test]
    fn teams_guessed_formats() {
        for text in [TEAMS_GUESSED, TEAMS_INLINE_GUESSED] {
            let r = read(text, &[]);
            let (speakers, _) = talk(&r);
            assert_eq!(speakers[..2], ["佐藤 花子", "森川 陽介"]);
            let saved = kept(&r, Some("森川 陽介"));
            assert_eq!(saved, "賛成です。私からは採用の進み具合を出します。");
            assert_clean(&saved, &["佐藤", "9/26", "議題", "budget"]);
        }
    }

    // A saved LINE history (.txt), Japanese: time TAB name TAB text, a quoted
    // message over two lines, stickers and photos, date lines. Format from
    // LINE's help and the article cited in the requirement (confidence high).
    const LINE_JA: &str = "[LINE] 佐藤 花子とのトーク履歴
保存日時：2026/09/26 11:00

2026/09/25(金)
21:03\t佐藤 花子\t明日の打ち合わせ、何時からにしますか？
21:05\t森川 陽介\t14時からでどうでしょう。資料は前日までに送ります。
21:06\t森川 陽介\t\"場所は駅前の会議室です。
地図はあとで送ります。\"
21:10\t佐藤 花子\t[スタンプ]
2026/09/26(土)
08:15\t森川 陽介\t[写真]
08:16\t森川 陽介\tおはようございます。資料を送りました。
";

    #[test]
    fn line_history_ja() {
        let r = read(LINE_JA, &[]);
        let (speakers, _) = talk(&r);
        assert_eq!(speakers, ["佐藤 花子", "森川 陽介"]);
        let saved = kept(&r, Some("森川 陽介"));
        assert_eq!(
            saved,
            "14時からでどうでしょう。資料は前日までに送ります。\n\n場所は駅前の会議室です。\n地図はあとで送ります。\n\nおはようございます。資料を送りました。"
        );
        assert_clean(&saved, &["佐藤", "LINE", "トーク履歴", "保存日時", "2026", "21:", "何時から", "打ち合わせ", "スタンプ", "写真", "\""]);
    }

    const LINE_EN: &str = "[LINE] Chat history with Jordan Lee
Saved on: 9/26/2026, 11:00

Fri, 9/25/2026
21:03\tJordan Lee\tWhat time works tomorrow?
21:05\tAlex Rivera\tHow about two? I'll send the slides the day before.
21:10\tJordan Lee\t[Sticker]
";

    #[test]
    fn line_history_en() {
        let r = read(LINE_EN, &[]);
        let saved = kept(&r, Some("Alex Rivera"));
        assert_eq!(saved, "How about two? I'll send the slides the day before.");
        assert_clean(&saved, &["Jordan", "What time", "Sticker", "Saved", "21:"]);
    }

    // Discord: GUESSED. "Name — Today 10:21" above the text and "[10:24]text"
    // for the same person again, as copies are commonly described; not
    // checked against a source. A code block is dropped.
    const DISCORD_GUESSED: &str = "佐藤 花子 — 今日 10:21
ビルドが落ちてます、誰か見られますか
森川 陽介 — 今日 10:23
見ます。依存の更新で型が変わったみたいです。
[10:24]直しました。 @佐藤 花子 もう一度走らせてみてください
[10:26]原因はこれでした
```
let limit: u32 = 40;
```
佐藤 花子 — 今日 10:30
ありがとうございます！通りました
Jordan Lee — Today at 10:31 AM
nice
";

    #[test]
    fn discord_guessed_format() {
        let r = read(DISCORD_GUESSED, &[]);
        let (speakers, _) = talk(&r);
        assert_eq!(speakers, ["佐藤 花子", "森川 陽介", "Jordan Lee"]);
        let saved = kept(&r, Some("森川 陽介"));
        assert_eq!(saved, "見ます。依存の更新で型が変わったみたいです。\n\n直しました。 もう一度走らせてみてください\n\n原因はこれでした");
        assert_clean(&saved, &["佐藤", "今日", "10:", "ビルドが落ち", "通りました", "limit", "u32", "```", "nice"]);
    }

    // A mail reply copied with its header (Gmail-like, Japanese): the sender
    // line with an address, the time under it, "To", the reply, and the
    // quoted mail under "… <address>:". Confidence high for the quote line.
    const MAIL_JA: &str = "森川 陽介 <yosuke.morikawa@example.com>
10:23 (2 時間前)
To 佐藤

佐藤さん

資料ありがとうございます。三章の数字は、前年と同じ基準でそろえておきます。

森川

2026年9月25日(木) 18:02 佐藤 花子 <hanako.sato@example.com>:
> 森川さん
>
> 来週の決算説明会の資料をお送りします。
> 三章の数字だけ確認をお願いします。
";

    #[test]
    fn mail_reply_ja() {
        let r = read(MAIL_JA, &[]);
        let (speakers, _) = talk(&r);
        assert_eq!(speakers, ["森川 陽介"]);
        let saved = kept(&r, Some("森川 陽介"));
        assert_eq!(saved, "佐藤さん\n資料ありがとうございます。三章の数字は、前年と同じ基準でそろえておきます。\n森川");
        assert_clean(&saved, &["佐藤 花子", "hanako", "example.com", "10:23", "時間前", "To", "決算説明会", "お送りします", "2026"]);
    }

    // A mail reply with no header of your own (English): the reply has no
    // name above it, and the wrapped "On …, Name <\naddress> wrote:" line
    // and everything quoted under it go.
    const MAIL_EN: &str = "Hi Jordan,

Thanks for the draft. I moved the pricing section up, since that is what people ask about first.

Alex

On Thu, Sep 25, 2026 at 6:02 PM Jordan Lee <
jordan.lee@example.com> wrote:

> Hi Alex,
> Here is the first draft of the launch post.
";

    #[test]
    fn mail_reply_en_has_no_name() {
        let r = read(MAIL_EN, &[]);
        let (speakers, messages) = talk(&r);
        assert!(speakers.is_empty());
        assert!(messages.iter().all(|m| m.speaker.is_none()));
        let saved = kept(&r, None);
        assert_eq!(saved, "Hi Jordan,\nThanks for the draft. I moved the pricing section up, since that is what people ask about first.\nAlex");
        assert_clean(&saved, &["Jordan Lee", "example.com", "wrote", "On Thu", "launch post", "6:02"]);
    }

    // Google Chat: GUESSED. "Name, 10:21" above the text; not checked
    // against a source.
    const GOOGLE_CHAT_GUESSED: &str = "佐藤 花子, 10:21
今日の午後、少し話せますか？
森川 陽介, 10:23
15時以降なら空いています。
佐藤 花子, 10:24
ではその時間で。
";

    #[test]
    fn google_chat_guessed_format() {
        let r = read(GOOGLE_CHAT_GUESSED, &[]);
        let saved = kept(&r, Some("森川 陽介"));
        assert_eq!(saved, "15時以降なら空いています。");
    }

    // Chat logs and minutes: "[time] Name: text" and "Name：text".
    const LOG_STAMPED: &str = "[10:21] 佐藤: 来週の件、進んでいますか
[10:23] 森川: はい。見積もりは金曜に出します。
[10:24] 佐藤: 了解です
[10:30] 森川: 了解です。念のため、条件は先に文章で残しておきます。
";

    const LOG_MINUTES: &str = "佐藤：では始めます。今日は採用の進め方です。
森川：まず、評価の基準を先に揃えたいです。
佐藤：賛成です。
森川：面談官ごとのばらつきを、点数ではなく言葉で見ます。
野村：私は日程の調整を持ちます。
";

    #[test]
    fn name_colon_logs() {
        let r = read(LOG_STAMPED, &[]);
        assert_eq!(talk(&r).0, ["佐藤", "森川"]);
        assert_eq!(kept(&r, Some("森川")), "はい。見積もりは金曜に出します。\n\n了解です。念のため、条件は先に文章で残しておきます。");

        let r = read(LOG_MINUTES, &[]);
        assert_eq!(talk(&r).0, ["佐藤", "森川", "野村"]);
        let saved = kept(&r, Some("森川"));
        assert_eq!(saved, "まず、評価の基準を先に揃えたいです。\n\n面談官ごとのばらつきを、点数ではなく言葉で見ます。");
        assert_clean(&saved, &["佐藤", "野村", "始めます", "日程"]);
    }

    // Ordinary writing, with quoted speech and a time inside a sentence,
    // stays ordinary: no names, no sentence about times.
    const ESSAY: &str = "「それは、本当に必要ですか」と彼女は言った。
私はしばらく黙っていた。朝 7:30 の電車に乗るまで、ずっと考えていた。

「必要だと思う」
そう答えたのは、三日後のことだった。

注意: ここから先は、あくまで私の考えです。
結論から言えば、撤退基準は始める前に数字で決めておくべきだ。
";

    const ESSAY_EN: &str = "\"Do we really need this?\" she asked.

I did not answer until the train at 7:30 had left.
Note: this is only how I see it.
Three days later I said yes.
";

    #[test]
    fn prose_is_plain() {
        assert_eq!(read(ESSAY, &[]), Reading::Plain);
        assert_eq!(read(ESSAY_EN, &[]), Reading::Plain);
    }

    // An interview may be read as a conversation; "all of it is mine" puts it
    // back as it was, which the caller does with the text it still holds.
    #[test]
    fn interview_may_be_a_conversation_between_q_and_a() {
        let text = "Q: 起業したきっかけを教えてください。\nA: 前の会社で、資金繰りに苦しむ取引先をたくさん見たからです。\nQ: いちばん大変だったことは？\nA: 最初の採用です。\n";
        match read(text, &[]) {
            Reading::Plain => {}
            Reading::Talk { speakers, .. } => assert_eq!(speakers, ["Q", "A"]),
            Reading::Unsure => panic!("an interview has no times"),
        }
    }

    #[test]
    fn one_person_throughout_is_still_a_conversation() {
        let r = read("森川 陽介  昨日 18:02\n採用の件、進めます。\n森川 陽介  10:23\n資金繰り表を週次にしました。\n", &[]);
        assert_eq!(talk(&r).0, ["森川 陽介"]);
        assert_eq!(kept(&r, Some("森川 陽介")), "採用の件、進めます。\n\n資金繰り表を週次にしました。");
    }

    #[test]
    fn one_header_or_dated_headings_are_plain() {
        assert_eq!(read("森川 陽介  10:23\n採用の件、進めます。\n", &[]), Reading::Plain);
        assert_eq!(read("2026/09/25\n朝から雨だった。\n\n2026/09/26\n晴れた。資金繰りを見直した。\n", &[]), Reading::Plain);
    }

    #[test]
    fn times_without_names_are_unsure() {
        let text = "10:21\n来週の採用面談の件です。\n10:23\n資金繰り表は週次に切り替えました。\n10:40\n撤退基準を先に決めます。\n";
        assert_eq!(read(text, &[]), Reading::Unsure);
    }

    #[test]
    fn a_message_after_a_header_is_never_taken_for_a_name() {
        let text = "森川 陽介  10:23\n了解です\n10:24\n明日やります\n佐藤 花子  10:30\nお願いします\n";
        let r = read(text, &[]);
        assert_eq!(talk(&r).0, ["森川 陽介", "佐藤 花子"]);
        assert_eq!(kept(&r, Some("森川 陽介")), "了解です\n\n明日やります");
    }

    #[test]
    fn short_messages_are_kept() {
        let r = read("佐藤 花子  10:21\n確認お願いします\n森川 陽介  10:22\n了解です\n", &[]);
        assert_eq!(kept(&r, Some("森川 陽介")), "了解です");
    }

    #[test]
    fn the_same_messages_are_not_added_twice() {
        let first = read(SLACK_JA, &[]);
        let saved = kept(&first, Some("森川 陽介"));
        // Pasting the same conversation again: nothing new.
        let again = read(SLACK_JA, std::slice::from_ref(&saved));
        assert_eq!(kept(&again, Some("森川 陽介")), "");
        let (_, messages) = talk(&again);
        assert!(messages.iter().filter(|m| m.speaker.as_deref() == Some("森川 陽介")).all(|m| m.seen));
        // Overlapping by one message: only the rest is new.
        let partial = read(SLACK_JA, &["資金繰り表は 週次に切り替えました。".to_string()]);
        assert_eq!(kept(&partial, Some("森川 陽介")).matches("\n\n").count(), 1);
        assert!(!kept(&partial, Some("森川 陽介")).contains("資金繰り"));
    }

    #[test]
    fn a_speaker_with_nothing_left_is_still_named() {
        let r = read("佐藤 花子  10:21\n写真を送ります\n森川 陽介  10:22\n:+1:\n", &[]);
        assert_eq!(talk(&r).0, ["佐藤 花子", "森川 陽介"]);
        assert_eq!(kept(&r, Some("森川 陽介")), "");
    }

    #[test]
    fn links_keep_their_words() {
        let r = read("佐藤 花子  10:21\n見ました？\n森川 陽介  10:22\n<https://example.com/a|採用の手引き> と [評価の考え方](https://example.com/b) を読みました\n", &[]);
        assert_eq!(kept(&r, Some("森川 陽介")), "採用の手引き と 評価の考え方 を読みました");
    }

    #[test]
    fn serialises_for_the_screen() {
        let json = serde_json::to_value(read("佐藤 花子  10:21\nはい\n森川 陽介  10:22\nどうも\n", &[])).unwrap();
        assert_eq!(json["kind"], "talk");
        assert_eq!(json["messages"][1]["speaker"], "森川 陽介");
        assert_eq!(serde_json::to_value(Reading::Plain).unwrap()["kind"], "plain");
    }
}
