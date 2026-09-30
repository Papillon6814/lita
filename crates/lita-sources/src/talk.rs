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
//! When unsure, it leans away from a conversation, and away from putting
//! someone else's words under the person's name: a shape that an ordinary
//! line could also have is a name only if the same name heads another
//! message, and a mail intro needs a quote or a name to back it.
//!
//! Other people's messages are read here and handed back only so that the
//! person can choose who they are without pasting again; the caller keeps
//! them in memory and drops them. Nothing is stored and nothing goes to Codex
//! from this module.

use std::collections::{HashMap, HashSet};
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
    let lines = split_glued(lines);
    let mut kinds = classify(&lines);
    confirm_weak(&mut kinds);
    resolve_colons(&mut kinds);

    let named = kinds.iter().filter(|k| matches!(k, Kind::Header { .. })).count();
    let stamps = kinds.iter().filter(|k| matches!(k, Kind::Stamp { clock: true, .. } | Kind::Unknown)).count();
    // A mail intro alone is not enough: it needs a quote under it, a name
    // above a message, or a `From:` / `Sent:` pair.
    let backed_intro = kinds.iter().enumerate().any(|(i, k)| match k {
        Kind::Intro { firm } => *firm || named >= 1 || kinds[i + 1..].iter().find(|k| !matches!(k, Kind::Blank)).is_some_and(|k| matches!(k, Kind::Quote)),
        _ => false,
    });
    let talk = named >= 2 || (named >= 1 && named + stamps >= 2) || backed_intro;
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
    /// A bot's mark or a status emoji may come first (`APP  9:12 PM`,
    /// `アプリ  10:25`, `:palm_tree:  9:15 PM`): the name is on the line above.
    stamp_line: Regex,
    /// Whether a stamp says more than a bare clock (a date, a day, AM/PM).
    strong_stamp: Regex,
    /// Whether a stamp has a clock in it (a date divider does not).
    clock: Regex,
    /// `Name  10:23`, `Name [10:23 AM]`, `Name — Today 10:23`, `Name, 10:23`.
    /// A bot's mark after the name (`Jira Bot アプリ  10:25`) is not part of it.
    /// A bot is read like a person, by the same rules, under its name without
    /// the mark: nobody picks a bot as themselves, so its words stay apart
    /// from the person's either way, and one rule for everyone is easier to
    /// keep than a second one for bots.
    name_stamp: Regex,
    /// `[9/26 10:23] Name` (the stamp must carry a date or a day).
    stamp_name: Regex,
    /// `[10:23] Name: text` or `10:23 Name: text`.
    stamp_colon: Regex,
    /// `10:23<TAB>Name<TAB>text` (a saved LINE history).
    tab_line: Regex,
    /// `…textName  [10:04 PM]`: a header glued to the end of the line before
    /// it, as a copy from Slack on the web can do. `head` is the whole
    /// `Name  [time]` shape, `text` what comes before it.
    glued: Regex,
    /// `[10:24]text`: the same person again.
    stamp_text: Regex,
    /// `Name: text` / `Name<TAB>text`, a conversation only when it recurs.
    colon: Regex,
    tab_pair: Regex,
    /// A line that starts with a clock, for "times recur" alone.
    time_lead: Regex,
    /// Above a quoted mail: `On <date>, Name <a@b.c> wrote:`, `<date> Name のメッセージ:`,
    /// `… <a@b.c>:`, `-----Original Message-----`. A `wrote:` or `のメッセージ:`
    /// counts only with a date, a time or an address on it (or on the line it
    /// wraps from), so "As Drucker wrote:" stays prose.
    wrote: Regex,
    wrote_ja: Regex,
    addr_intro: Regex,
    separator: Regex,
    /// A date or a time anywhere in a line, for a mail intro.
    mail_when: Regex,
    /// `Name wrote on 2023/06/15 17:34:`: counts only with a date or a time.
    wrote_on: Regex,
    /// `From:` followed by `Sent:` / `Date:`: an unquoted forwarded mail.
    /// Also `*From:*` / `*Sent:*`, an Outlook header that Gmail turned into text.
    from: Regex,
    sent: Regex,
    /// The line before a wrapped `… <\naddr> wrote:`.
    intro_head: Regex,
    signature: Regex,
    /// Screen text, reactions, attachments, system lines, in Japanese and English.
    chrome: Vec<Regex>,
    /// A link preview: this line and the title under it (Discord's `Website`).
    preview: Regex,
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
    /// `(emoji)`, what a saved LINE history writes for an emoji.
    line_emoji: Regex,
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
    let bot = r"(?:APP|アプリ)";
    let mark = format!(r"(?:{bot}|:[a-z0-9_+\-]+:)");
    let re = |s: &str| Regex::new(s).expect("talk cue");
    Cues {
        stamp_line: re(&format!(r"^(?:{mark}\s+)?\[?\s*{stamp}\s*\]?{after}$")),
        strong_stamp: re(&format!(r"{day}|{date}|[AaPp]\.?[Mm]\.?$|午前|午後|{weekday}")),
        clock: re(r"\d{1,2}[:：]\d{2}"),
        name_stamp: re(&format!(r"^(?P<name>.+?)(?:\s+{bot})?(?P<sep>\s*[—–|・,]\s*|\s+)(?P<open>\[)?(?P<stamp>{stamp})\]?{after}$")),
        stamp_name: re(&format!(r"^\[(?P<stamp>{stamp})\]\s*(?P<name>[^:：\t\[\]]+?)$")),
        stamp_colon: re(&format!(r"^\[?(?P<stamp>{stamp})\]?\s+(?P<name>[^:：\t\[\]]{{1,30}}?)\s*[:：]\s*(?P<body>.*)$")),
        tab_line: re(&format!(r"^(?P<stamp>{clock})\t(?P<name>[^\t]{{1,40}})\t(?P<body>.*)$")),
        glued: re(&format!(r"^(?P<text>.+?)\s{{2,}}\[(?P<stamp>{clock})\]$")),
        stamp_text: re(&format!(r"^\[(?P<stamp>{clock})\]\s*(?P<body>.+)$")),
        colon: re(r"^(?P<name>[^:：\s>][^:：]{0,23}?)\s*[:：]\s*(?P<body>.*)$"),
        tab_pair: re(r"^(?P<name>[^\t]{1,24})\t(?P<body>.+)$"),
        time_lead: re(&format!(r"^\[?{clock}\]?\s+\S")),
        wrote: re(r"(?i)\bwrote\s*:\s*$"),
        wrote_on: re(r"(?i)\bwrote\s+on\s.+[:：]\s*$"),
        wrote_ja: re(r"(?:のメッセージ|のメール|が書きました|は書きました|書き込みました)\s*[:：]\s*$"),
        addr_intro: re(r"<[^<>\s]+@[^<>\s]+>\s*[:：]\s*$"),
        separator: re(r"(?i)^-{2,}\s*(?:original message|forwarded message|元のメッセージ|転送されたメッセージ)\s*-{2,}$"),
        mail_when: re(&format!(r"{date}|{clock}")),
        from: re(r"^\*?(?:From|差出人)\s*[:：]\*?\s*\S"),
        sent: re(r"^\*?(?:Sent|Date|送信日時|日付)\s*[:：]"),
        intro_head: re(r"(?i)^(?:on\s|\d{4}年|\d{4}/)"),
        signature: re(r"^--\s*$"),
        chrome: [
            // The reply count and the last reply may share a line.
            r"^\d+\s*件の返信(?:\s+最終返信.*)?$",
            r"(?i)^\d+\s+repl(?:y|ies)(?:\s+last reply.*)?$",
            // More faces in a thread than shown.
            r"^\+\d{1,3}$",
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
            r"(?i)^(?:\(edited\)|[(（]編集済み?[)）]|edited|編集済み?)$",
            r"(?i)^(?:seen by|既読).*$",
            r"^\d+$",
            r"^\.$",
            // An old Teams reaction: its name and a count.
            r"(?i)^(?:like|heart|laugh|surprised|sad|angry)\s+\d+$",
            // A LINE item in brackets, alone or with what it is (`[位置情報] 住所`).
            r"(?i)^\[(?:スタンプ|写真|動画|ファイル|アルバム|ボイスメッセージ|通話|位置情報|連絡先|ノート|投票|プレゼント|sticker|photo|video|file|album|voice message|call|location|contact|note|poll|gift)[^\]]{0,20}\](?:\s.*)?$",
            // A LINE call line.
            r"^☎.*$",
            // A LINE system line: the name column is empty.
            r"^\d{1,2}:\d{2}\t\t.*$",
            // An attachment and its size.
            r"(?i)^(?:image|expand)$",
            r"(?i)^\d+(?:\.\d+)?\s*(?:bytes|kb|mb|gb)$",
            r"(?i)^\[LINE\]\s.*$",
            r"(?i)^(?:保存日時|saved on)\s*[:：].*$",
            r"(?i)^[^\s/]+\.(?:pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|heic|zip|csv|txt|key|numbers|pages|mp4|mov)$",
            r"(?i)^(?:www\.)?[a-z0-9\-]+(?:\.[a-z0-9\-]+)*\.[a-z]{2,}$",
        ]
        .iter()
        .map(|s| re(s))
        .collect(),
        preview: re(r"^Website$"),
        head_chrome: re(r"(?i)^(?:(?:to|cc|bcc|宛先|cc)\s*[:：]?\s+\S.{0,60}|to me|自分宛て?)$"),
        slack_link: re(r"<https?://[^|>\s]+\|([^>]+)>"),
        md_link: re(r"\[([^\]]+)\]\(https?://[^)\s]+\)"),
        angle_url: re(r"<https?://[^>\s]+>"),
        url: re(r"https?://\S+"),
        slack_mention: re(r"<[@#!][A-Za-z0-9^]+(?:\|[^>]*)?>"),
        mention: re(r"[@＠][^\s@＠、。,.!?！？()（）]+"),
        emoji_code: re(r":(?:[a-z0-9_+\-]*[a-z][a-z0-9_+\-]*|[+\-]1):"),
        line_emoji: re(r"\(emoji\)"),
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
    /// A name heads what follows. `body` is text on the same line. `weak`:
    /// the shape could also be an ordinary line (`Name, 10:23`, `Name 9/26
    /// 10:23`, a line above a time alone), so it stays a name only when the
    /// same name heads another message too.
    Header { name: String, body: Option<String>, weak: bool },
    /// A weak header whose name heads nothing else. What follows it is
    /// nobody's: not the previous person's, and not offered as a name.
    Unknown,
    /// A time (or a date) alone, or `[10:24]text`: the same person goes on.
    Stamp { clock: bool, body: Option<String> },
    /// `Name: text` that only counts when it recurs; `line` is kept to fall back on.
    Colon { name: String, body: String, line: String },
    /// The line above a quoted mail: what follows is someone else's.
    /// `firm`: a `From:` / `Sent:` pair, a conversation by itself.
    Intro { firm: bool },
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
        let prev = if i > 0 { lines[i - 1].as_str() } else { "" };
        let kind = if l.is_empty() {
            Kind::Blank
        } else if l.starts_with('>') || l.starts_with('＞') {
            Kind::Quote
        } else if let Some(k) = intro(l, prev, next) {
            k
        } else if c.signature.is_match(l) {
            Kind::Signature
        } else if c.preview.is_match(l) {
            if !next.is_empty() {
                out.push(Kind::Chrome);
                i += 1;
            }
            Kind::Chrome
        } else if is_chrome(l) || (after_head && c.head_chrome.is_match(l)) {
            Kind::Chrome
        } else if let Some(k) = header_on_line(l) {
            k
        } else if c.glued.is_match(l) {
            // A header's shape whose name could not be read, glued to other
            // text (see `split_glued`). Where the previous message ends and
            // who speaks next cannot be told, so what follows is nobody's.
            Kind::Unknown
        } else if !after_head && c.stamp_line.is_match(next) && c.clock.is_match(next) {
            match name(l).filter(|n| heading_name(n)) {
                Some(n) => {
                    i += 1;
                    // A sender line with an address is a name for sure.
                    Kind::Header { name: n, body: None, weak: !c.email.is_match(l) }
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

/// Splits `…textName  [10:04 PM]` into `…text` and `Name  [10:04 PM]` when
/// `Name` heads a message on a line of its own elsewhere in the paste and
/// the text runs straight into it (no space between). Anything else is left
/// as it is; `classify` then treats a glued line it cannot read as `Unknown`.
fn split_glued(lines: Vec<String>) -> Vec<String> {
    let c = &*CUES;
    let mut known: Vec<String> = lines
        .iter()
        .filter_map(|l| match header_on_line(l) {
            Some(Kind::Header { name, body: None, weak: false }) => Some(name),
            _ => None,
        })
        .collect();
    known.sort_by_key(|n| std::cmp::Reverse(n.chars().count()));
    known.dedup();
    let mut out = Vec::with_capacity(lines.len());
    for l in lines {
        let split = c.glued.captures(&l).and_then(|m| {
            let text = &m["text"];
            known.iter().find_map(|n| {
                let before = text.strip_suffix(n.as_str())?;
                (!before.is_empty() && !before.ends_with(char::is_whitespace))
                    .then(|| (before.to_string(), format!("{n}  [{}]", &m["stamp"])))
            })
        });
        match split {
            Some((before, head)) => {
                out.push(before);
                out.push(head);
            }
            None => out.push(l),
        }
    }
    out
}

/// A line that is a header (or a stamp) by itself, without looking around.
fn header_on_line(l: &str) -> Option<Kind> {
    let c = &*CUES;
    if let Some(m) = c.tab_line.captures(l)
        && let Some(n) = name(&m["name"]) {
            return Some(Kind::Header { name: n, body: Some(m["body"].to_string()), weak: false });
        }
    if c.stamp_line.is_match(l) {
        return Some(Kind::Stamp { clock: c.clock.is_match(l), body: None });
    }
    if let Some(m) = c.stamp_colon.captures(l)
        && let Some(n) = name(&m["name"]) {
            return Some(Kind::Header { name: n, body: Some(m["body"].to_string()), weak: false });
        }
    if let Some(m) = c.stamp_name.captures(l) {
        if !c.strong_stamp.is_match(&m["stamp"]) || !c.clock.is_match(&m["stamp"]) {
            // `[10:24]text` is the same person going on, not a name.
        } else if let Some(n) = name(&m["name"]) {
            return Some(Kind::Header { name: n, body: None, weak: false });
        }
    }
    if let Some(m) = c.stamp_text.captures(l) {
        return Some(Kind::Stamp { clock: true, body: Some(m["body"].to_string()) });
    }
    if let Some(m) = c.name_stamp.captures(l) {
        let sep = &m["sep"];
        let mark = sep.trim();
        let stamp = &m["stamp"];
        // "集合は 10:30" and "締切は 9/30" are sentences. A name heads a
        // message only with a clock after it, and sits apart from it by a
        // bracket, a dash or a bar, or two spaces. A comma, or one space
        // before a date and a clock, is weak: "OK, 10:30" is a sentence too.
        let firm = mark != "," && (m.name("open").is_some() || !mark.is_empty() || sep.chars().count() >= 2);
        let weak = mark == "," || c.strong_stamp.is_match(stamp);
        if c.clock.is_match(stamp) && (firm || weak)
            && let Some(n) = name(&m["name"]).filter(|n| heading_name(n)) {
                return Some(Kind::Header { name: n, body: None, weak: !firm });
            }
    }
    None
}

/// The line above a quoted or forwarded mail, or `None`.
fn intro(l: &str, prev: &str, next: &str) -> Option<Kind> {
    let c = &*CUES;
    if c.from.is_match(l) && c.sent.is_match(next) {
        return Some(Kind::Intro { firm: true });
    }
    if c.separator.is_match(l) || c.addr_intro.is_match(l) {
        return Some(Kind::Intro { firm: false });
    }
    // "On Thu, Sep 25, 2026 at 6:02 PM Jordan Lee <" may wrap before "wrote:".
    let dated = |s: &str| c.mail_when.is_match(s) || s.contains('@');
    let wrote = c.wrote.is_match(l)
        && (l.contains('@') || (c.intro_head.is_match(l) && dated(l)) || (c.intro_head.is_match(prev) && dated(prev)));
    let wrote_on = c.wrote_on.is_match(l) && c.mail_when.is_match(l);
    let wrote_ja = c.wrote_ja.is_match(l) && (dated(l) || dated(prev));
    (wrote || wrote_on || wrote_ja).then_some(Kind::Intro { firm: false })
}

/// Whether a name found above a message could be a person's rather than the
/// start of a sentence: no particle after a word ("締切は"), no polite verb
/// ending, no English function word ("The launch is on").
fn heading_name(n: &str) -> bool {
    let hiragana = |ch: char| ('\u{3041}'..='\u{309F}').contains(&ch);
    // A particle right after a kanji, katakana or latin word; a name written
    // in hiragana ("まこと", "ちから") keeps its ending.
    for tail in ["から", "まで", "より", "には", "では", "とは", "って", "は", "が", "を", "に", "で", "へ", "も", "と", "の", "や"] {
        if let Some(head) = n.strip_suffix(tail)
            && head.chars().last().is_some_and(|ch| !hiragana(ch) && !ch.is_whitespace())
        {
            return false;
        }
    }
    if ["です", "ます", "でした", "ました"].iter().any(|w| n.contains(w)) {
        return false;
    }
    const FUNCTION_WORDS: [&str; 19] = [
        "an", "and", "at", "be", "by", "due", "for", "from", "in", "is", "are", "of", "on", "the", "to", "until", "was", "were", "with",
    ];
    !n.split_whitespace().any(|w| FUNCTION_WORDS.contains(&w.to_lowercase().as_str()))
}

/// A weak header stays a name only when the same name heads another
/// message in the paste; otherwise it becomes `Unknown`.
///
/// `[15:12] Name` (a clock with no date, then a name) looks the same as
/// `[10:24]text`, the same person going on. When that text is a name that
/// heads another message for sure, it is that person, not the previous one's words.
fn confirm_weak(kinds: &mut [Kind]) {
    let mut count: HashMap<String, usize> = HashMap::new();
    for k in kinds.iter() {
        if let Kind::Header { name, .. } = k {
            *count.entry(name.clone()).or_default() += 1;
        }
    }
    let firm: HashSet<String> = kinds
        .iter()
        .filter_map(|k| if let Kind::Header { name, weak: false, .. } = k { Some(name.clone()) } else { None })
        .collect();
    for k in kinds.iter_mut() {
        if let Kind::Stamp { body: Some(b), .. } = k
            && let Some(n) = name(b).filter(|n| firm.contains(n))
        {
            *count.entry(n.clone()).or_default() += 1;
            *k = Kind::Header { name: n, body: None, weak: false };
        }
    }
    for k in kinds.iter_mut() {
        if let Kind::Header { name, weak: true, .. } = k
            && count.get(name.as_str()).copied().unwrap_or(0) < 2
        {
            *k = Kind::Unknown;
        }
    }
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
                Kind::Header { name: std::mem::take(name), body: Some(std::mem::take(body)), weak: false }
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
            Kind::Header { name, body, .. } => {
                quoting = false;
                out.push((Some(name), body.into_iter().collect()));
            }
            Kind::Stamp { body, .. } => {
                let who = out.last().and_then(|m| m.0.clone());
                if !quoting {
                    out.push((who, body.into_iter().collect()));
                }
            }
            // Nobody's: skipped until the next name.
            Kind::Unknown => quoting = true,
            Kind::Intro { .. } => {
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
        s = c.line_emoji.replace_all(&s, "").to_string();
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
Jordan Lee
10:20 AM
Thanks, that helps.
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
        assert_clean(&saved, &["Jordan", "Sam", "Alex", "AM", "churn", "Nice", "cc", "joined", "repl", "thread", "edited", "thinking", "Thanks"]);
    }

    // Teams: GUESSED, close to the old Teams (1.x, until mid 2024), which put
    // "[time] Name" above the text (see `TEAMS_OLD` for its checked shape).
    // The new Teams copies the text only, with no name and no time (Microsoft
    // Q&A, 2024-08 to 2026-08), so neither spelling here comes from it now.
    // Each name speaks twice: a name after one space counts only then.
    const TEAMS_GUESSED: &str = "[9/26 10:21] 佐藤 花子
来週の定例、議題を先に集めませんか
[9/26 10:23] 森川 陽介
賛成です。私からは採用の進み具合を出します。
[9/26 10:25] Mika Tanaka
I'll add the budget review.
[9/26 10:26] 佐藤 花子
お願いします。
[9/26 10:27] 森川 陽介
資料は金曜に出します。
";

    // Teams, the other guessed spelling: "Name date time" on one line. No
    // source was found for it in any Teams version; kept as a generic shape.
    const TEAMS_INLINE_GUESSED: &str = "佐藤 花子 9/26 10:21 AM
来週の定例、議題を先に集めませんか
森川 陽介 9/26 10:23 AM
賛成です。私からは採用の進み具合を出します。
佐藤 花子 9/26 10:26 AM
お願いします。
森川 陽介 9/26 10:27 AM
資料は金曜に出します。
";

    #[test]
    fn teams_guessed_formats() {
        for text in [TEAMS_GUESSED, TEAMS_INLINE_GUESSED] {
            let r = read(text, &[]);
            let (speakers, _) = talk(&r);
            assert_eq!(speakers[..2], ["佐藤 花子", "森川 陽介"]);
            let saved = kept(&r, Some("森川 陽介"));
            assert_eq!(saved, "賛成です。私からは採用の進み具合を出します。\n\n資料は金曜に出します。");
            assert_clean(&saved, &["佐藤", "9/26", "議題", "budget", "お願いします"]);
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
    // against a source. A comma is weak, so each name speaks twice.
    const GOOGLE_CHAT_GUESSED: &str = "佐藤 花子, 10:21
今日の午後、少し話せますか？
森川 陽介, 10:23
15時以降なら空いています。
佐藤 花子, 10:24
ではその時間で。
森川 陽介, 10:25
資料はその前に送ります。
";

    #[test]
    fn google_chat_guessed_format() {
        let r = read(GOOGLE_CHAT_GUESSED, &[]);
        let saved = kept(&r, Some("森川 陽介"));
        assert_eq!(saved, "15時以降なら空いています。\n\n資料はその前に送ります。");
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

    // Ordinary lines that end in a date or a time are not names above a
    // message: a date alone never heads one, a sentence is not a name, and
    // "OK, 10:30" is a name only if the same name heads another message.
    #[test]
    fn lines_ending_in_a_date_or_time_are_not_headers() {
        for text in [
            "締切は 9/30\n資料をまとめて送る。\n発表は 10月5日\n練習は前日にする。\n",
            "Released Sep 30\nThe notes are below.\n砂糖 1/2\n塩 少々\n",
            "OK, 10:30\n了解です。\n締切は 9/30\n",
            "締切は 9/30 18:00\n資料を送る。\n発表は 10/5 10:00\n練習する。\n",
            "The launch is on Sep 30 10:00\nWe meet at 9/29 15:00\n",
        ] {
            assert_eq!(read(text, &[]), Reading::Plain, "{text:?}");
        }
        let r = read("Deadline 9/30 18:00\nSend the deck.\nKickoff 10/5 10:00\nBook the room.\n", &[]);
        assert!(!matches!(r, Reading::Talk { .. }), "{r:?}");
    }

    // A line followed by a time alone is taken for a name only when that
    // name heads another message too. Otherwise what follows is nobody's:
    // it is neither the previous person's nor offered as a name.
    #[test]
    fn a_line_above_a_time_is_a_name_only_when_it_recurs() {
        let r = read("森川 陽介  10:21\n了解です\nOK\n10:22\n次の発言です\n佐藤 花子  10:30\nお願いします\n", &[]);
        let (speakers, _) = talk(&r);
        assert_eq!(speakers, ["森川 陽介", "佐藤 花子"]);
        assert_eq!(kept(&r, Some("森川 陽介")), "了解です");

        let r = read("Alex Rivera\n10:01 AM\nFirst thing.\nJordan Lee\n10:02 AM\nJordan's only words.\nAlex Rivera\n10:05 AM\nMine again.\n", &[]);
        let (speakers, _) = talk(&r);
        assert_eq!(speakers, ["Alex Rivera"]);
        let saved = kept(&r, Some("Alex Rivera"));
        assert_eq!(saved, "First thing.\n\nMine again.");
        assert_clean(&saved, &["Jordan"]);
    }

    // "… wrote:" in an essay is not the top of a quoted mail, and a mail
    // intro makes a conversation only with a quote or a name to back it.
    #[test]
    fn wrote_in_prose_is_plain() {
        for text in [
            "As Drucker wrote:\nThe purpose of a business is to create a customer.\nI agree with this.\n",
            "On Sep 30, Drucker wrote:\nThe purpose of a business is to create a customer.\n",
            "山田さんはこう書きました:\n撤退基準は先に決める。\n",
            "As Drucker wrote on Sep 30:\nThe purpose of a business is to create a customer.\n",
        ] {
            assert_eq!(read(text, &[]), Reading::Plain, "{text:?}");
        }
    }

    // ----- shapes checked against sources (2026-09-30) --------------------
    // The shapes below follow copies found in public sources; the names and
    // words are still invented. Sources: docs/pm/dev/2026-09-30-talk-real-formats.md.

    // Slack, English screen, as pasted from the app in 2023 (blog.danielna.com):
    // a name line, an indented time line, a time without AM/PM for the same
    // person again, a bot's `APP  9:12 PM`, a status emoji before the time,
    // `+2` for the thread's faces and the thread line run together.
    const SLACK_EN_REAL: &str = "
Dan Na
  9:08 PM
Hello this is a test!
:tada:
1

Alex Rivera
  9:10 PM
The drop is mostly in annual plans.
9:11
I will write it up before Friday.
+2
2 replies
Last reply 9 days agoView thread

GitHub
APP  9:12 PM
Pull request #12 opened by Dan Na

Dan Na
:palm_tree:  9:15 PM
Thanks, that helps.

Alex Rivera
  11:22 AM
One more thing: set the stop rule first. (edited)
";

    #[test]
    fn slack_en_real_copy() {
        let r = read(SLACK_EN_REAL, &[]);
        let (speakers, _) = talk(&r);
        assert_eq!(speakers, ["Dan Na", "Alex Rivera"]);
        let saved = kept(&r, Some("Alex Rivera"));
        assert_eq!(saved, "The drop is mostly in annual plans.\n\nI will write it up before Friday.\n\nOne more thing: set the stop rule first.");
        assert_clean(&saved, &["Dan", "GitHub", "APP", "palm", "+2", "repl", "thread", "PM", "9:", "Hello", "Thanks", "Pull request", "tada", "edited"]);
        // A bot heard once is nobody's, not a person's.
        let (_, messages) = talk(&r);
        assert!(messages.iter().all(|m| !m.body.contains("Pull request")), "{messages:?}");
    }

    // Slack, Japanese screen, with the name and the time on two lines as in
    // English. Screen words from a 2022 Japanese Slack (docswell): `N件の返信
    // 最終返信: 12日前` on one line, a bot marked `アプリ`. Confidence low: the
    // line order is carried over from English.
    const SLACK_JA_TWO_LINES: &str = "9月26日(金)
佐藤 花子
  10:21
来週の採用面談、評価シートはどこですか？
森川 陽介
  10:23
共有ドライブの「採用」フォルダに置きました。
10:24
火曜までにコメントをもらえると助かります。
2件の返信 最終返信: 12日前
Jira Bot アプリ  10:25
Task を作成しました
佐藤 花子
  10:30
承知しました。
森川 陽介
  10:32
資金繰り表は週次に切り替えました。
";

    #[test]
    fn slack_ja_two_lines() {
        let r = read(SLACK_JA_TWO_LINES, &[]);
        let (speakers, _) = talk(&r);
        assert_eq!(speakers, ["佐藤 花子", "森川 陽介", "Jira Bot"]);
        let saved = kept(&r, Some("森川 陽介"));
        assert_eq!(saved, "共有ドライブの「採用」フォルダに置きました。\n\n火曜までにコメントをもらえると助かります。\n\n資金繰り表は週次に切り替えました。");
        assert_clean(&saved, &["佐藤", "森川", "10:", "件の返信", "最終返信", "日前", "Jira", "アプリ", "Task", "評価シート", "承知"]);
    }

    // The bot's mark on a line of its own, under the bot's name.
    #[test]
    fn a_bot_mark_is_not_a_name() {
        let r = read("佐藤 花子\n10:21\n確認お願いします\nJira Bot\nアプリ  10:22\nTask を作成しました\n佐藤 花子\n10:23\nありがとう\n", &[]);
        let (speakers, messages) = talk(&r);
        assert_eq!(speakers, ["佐藤 花子"]);
        assert!(messages.iter().all(|m| !m.body.contains("Task") && !m.body.contains("アプリ")), "{messages:?}");
    }

    // A saved LINE history (.txt) as in real files (nakasyou/Patchouli,
    // linelog2py): a system line with the name column empty, a message in
    // quotes over lines with the closing quote alone, `(emoji)`, a location,
    // a call line, and an unsent message with no name.
    const LINE_REAL: &str = "[LINE] 広報チームのトーク
保存日時：2026/09/30 10:00

2026/09/26(金)
00:10\t\t田中さんが参加しました。
10:21\t佐藤 花子\t来週の定例どうしますか
10:23\t森川 陽介\t\"議題は二つです。
採用と予算です。
\"
10:24\t森川 陽介\t[スタンプ]
10:25\t佐藤 花子\t了解です(emoji)
10:26\t森川 陽介\t[位置情報] 東京都千代田区丸の内1-1
10:27\t佐藤 花子\t☎ 通話時間 0:07
10:28\t森川 陽介\t資料は金曜に出します。(emoji)
10:29\t\tメッセージの送信を取り消しました
";

    #[test]
    fn line_history_real() {
        let r = read(LINE_REAL, &[]);
        let (speakers, messages) = talk(&r);
        assert_eq!(speakers, ["佐藤 花子", "森川 陽介"]);
        assert!(messages.iter().all(|m| m.speaker.is_some()), "{messages:?}");
        let saved = kept(&r, Some("森川 陽介"));
        assert_eq!(saved, "議題は二つです。\n採用と予算です。\n\n資料は金曜に出します。");
        assert_clean(&saved, &["田中", "参加", "取り消し", "emoji", "位置情報", "東京都", "通話", "☎", "\"", "スタンプ"]);
        assert_clean(&kept(&r, Some("佐藤 花子")), &["emoji", "通話", "☎"]);
    }

    #[test]
    fn line_history_en_saved_on_with_dots() {
        let text = "[LINE] Chat history with Jordan Lee\nSaved on: 11/04/2018 17.55\n\nMon, 01/01/2018\n21:03\tJordan Lee\tWhat time works?\n21:05\tAlex Rivera\tTwo works.\n";
        let saved = kept(&read(text, &[]), Some("Alex Rivera"));
        assert_eq!(saved, "Two works.");
    }

    // The older LINE file, space-separated: where the name ends cannot be
    // told, so it is not read as a conversation with names.
    #[test]
    fn line_history_old_spaces_is_not_split() {
        let text = "2019.12.23 月曜日\n15:16 佐藤 花子 来週の定例どうしますか\n15:18 森川 陽介 議題は二つです\n15:20 佐藤 花子 了解です\n";
        assert_eq!(read(text, &[]), Reading::Unsure);
    }

    // Discord, English, copied from the app (LangChain's Discord loader docs,
    // 2023): a link preview (`Website` and its title) and an attached `Image`.
    const DISCORD_REAL: &str = "talkingtower — 08/15/2023 11:10 AM
Love music! Do you like jazz?
reporterbob — 08/15/2023 9:27 PM
Yes! Jazz is fantastic. Ever heard this one?
Website
Listen to classic jazz track...

talkingtower — Yesterday at 5:03 AM
Indeed! Great choice.
reporterbob — Today at 2:38 PM
I keep coming back to it.
[2:40 PM]
Image
Also this one.
";

    #[test]
    fn discord_real_copy() {
        let r = read(DISCORD_REAL, &[]);
        let (speakers, _) = talk(&r);
        assert_eq!(speakers, ["talkingtower", "reporterbob"]);
        let saved = kept(&r, Some("reporterbob"));
        assert_eq!(saved, "Yes! Jazz is fantastic. Ever heard this one?\n\nI keep coming back to it.\n\nAlso this one.");
        assert_clean(&saved, &["Website", "Listen to", "Image", "talkingtower", "Today", "PM", "jazz?", "Great choice"]);
    }

    // Discord, Japanese screen (2018 wiki): `(編集済)` on a line of its own.
    #[test]
    fn discord_ja_edited_line() {
        let r = read("佐藤 花子 — 今日 10:21\nビルドが落ちてます\n森川 陽介 — 今日 10:23\n見ます。\n(編集済)\n", &[]);
        assert_eq!(kept(&r, Some("森川 陽介")), "見ます。");
    }

    // Apple Mail, Japanese: `<date>、Name <addr>のメール:` above the quote
    // (a real mail in the W3C list archive).
    const MAIL_APPLE_JA: &str = "ありがとうございます。金曜までに直します。

2026/09/26 12:35、山口 拓 <taku@example.com>のメール:

> 資料の3ページ目、数字が古いようです。
> 確認をお願いします。
";

    #[test]
    fn mail_apple_ja() {
        let r = read(MAIL_APPLE_JA, &[]);
        let (speakers, _) = talk(&r);
        assert!(speakers.is_empty());
        let saved = kept(&r, None);
        assert_eq!(saved, "ありがとうございます。金曜までに直します。");
        assert_clean(&saved, &["山口", "taku", "のメール", "3ページ目", "確認をお願い", "12:35"]);
    }

    // Outlook's header as Gmail turns it into text (`*From:*`), and the
    // `Name wrote on <date>:` line; both real mails in list archives.
    #[test]
    fn mail_other_intros() {
        let text = "Thanks, I will fix the numbers by Friday.\n\n*From:* Jordan Lee <jordan.lee@example.com>\n*Sent:* Thursday, September 25, 2026 7:38:47 PM\n*To:* Alex Rivera\n*Subject:* RE: Deck\n\nAlex, page three still has last year's numbers.\n";
        let saved = kept(&read(text, &[]), None);
        assert_eq!(saved, "Thanks, I will fix the numbers by Friday.");

        let text = "了解しました。明日までに送ります。\n\n中村 誠 wrote on 2026/09/25 17:34:\n> 資料の件、いかがでしょうか。\n";
        let saved = kept(&read(text, &[]), None);
        assert_eq!(saved, "了解しました。明日までに送ります。");
    }

    // The new Teams (since mid 2024) copies only the text: nothing to tell
    // speakers apart by, so it is plain writing.
    #[test]
    fn teams_new_copies_text_only() {
        assert_eq!(read("Good morning!\n\nRight back at you!\n\nCan we move the review to Friday?\n", &[]), Reading::Plain);
    }

    // The old Teams (1.x, until mid 2024; superuser.com, Microsoft Tech
    // Community): `[time] Name` above the text, a name with a comma, a
    // reaction line ` angry 1`, and a 24-hour time with no date.
    const TEAMS_OLD: &str = "[Yesterday 8:15 AM] James Smith
Can you send the numbers before lunch?
[1:41 PM] Rivera, Alex
The drop is mostly in annual plans.
 angry 1


[1:45 PM] James Smith
Thanks, that helps.
[15:12] Rivera, Alex
I will write it up before Friday.
";

    #[test]
    fn teams_old_format() {
        let r = read(TEAMS_OLD, &[]);
        let (speakers, _) = talk(&r);
        assert_eq!(speakers, ["James Smith", "Rivera, Alex"]);
        let saved = kept(&r, Some("Rivera, Alex"));
        assert_eq!(saved, "The drop is mostly in annual plans.\n\nI will write it up before Friday.");
        assert_clean(&saved, &["James", "angry", "Rivera", "Thanks", "PM", "15:12"]);
    }

    // Slack on the web, English screen, checked with a real copy on
    // 2026-09-30 (the shape only; names and words invented): `Name  [9:12 PM]`
    // with two no-break spaces, and a header sometimes glued to the end of
    // the previous message's last line. The first line has no header.
    const SLACK_WEB_GLUED: &str = "来週の定例は火曜で大丈夫ですか
森川 陽介\u{a0}\u{a0}[9:12 PM]
火曜で大丈夫です。
Mika Tanaka\u{a0}\u{a0}[9:12 PM]
ありがとうございます
森川 陽介\u{a0}\u{a0}[9:27 PM]
議題は二つにします。\u{3000}採用と予算です。

資料は前日までに共有します。
Mika Tanaka\u{a0}\u{a0}[9:57 PM]
了解です。
予算の数字は私が用意します森川 陽介\u{a0}\u{a0}[10:04 PM]
助かります。数字は月次でお願いします。Mika Tanaka\u{a0}\u{a0}[10:15 PM]
承知しました。
";

    #[test]
    fn slack_web_glued_headers() {
        let r = read(SLACK_WEB_GLUED, &[]);
        let (speakers, _) = talk(&r);
        assert_eq!(speakers, ["森川 陽介", "Mika Tanaka"]);
        let mika = kept(&r, Some("Mika Tanaka"));
        assert_eq!(mika, "ありがとうございます\n\n了解です。\n予算の数字は私が用意します\n\n承知しました。");
        assert_clean(&mika, &["森川", "助かります", "PM", "["]);
        let me = kept(&r, Some("森川 陽介"));
        assert_eq!(me, "火曜で大丈夫です。\n\n議題は二つにします。 採用と予算です。\n資料は前日までに共有します。\n\n助かります。数字は月次でお願いします。");
        assert_clean(&me, &["Mika", "承知", "了解", "予算の数字は私", "PM"]);
    }

    // A header glued to a line whose name heads nothing else cannot be split
    // safely: what follows is nobody's rather than the previous person's.
    #[test]
    fn a_glued_header_with_an_unknown_name_is_nobodys() {
        let text = "森川 陽介  [9:12 PM]\n火曜で大丈夫です。\nMika Tanaka  [9:13 PM]\n了解です。数字は私が用意します。Sam Patel  [9:20 PM]\nSam の発言です。\n森川 陽介  [9:30 PM]\n助かります。\n";
        let r = read(text, &[]);
        let (_, messages) = talk(&r);
        assert!(messages.iter().all(|m| !m.body.contains("Sam")), "{messages:?}");
        assert_eq!(kept(&r, Some("森川 陽介")), "火曜で大丈夫です。\n\n助かります。");
    }

    // With only 24-hour times and no name heading a message anywhere, a
    // `[15:12] Name` line cannot be told from `[10:24]text`: not split.
    #[test]
    fn clock_then_name_alone_is_unsure() {
        let text = "[15:12] James Smith\nCan you send the numbers?\n[15:14] Alex Rivera\nSure, by noon.\n";
        assert_eq!(read(text, &[]), Reading::Unsure);
    }

    #[test]
    fn serialises_for_the_screen() {
        let json = serde_json::to_value(read("佐藤 花子  10:21\nはい\n森川 陽介  10:22\nどうも\n", &[])).unwrap();
        assert_eq!(json["kind"], "talk");
        assert_eq!(json["messages"][1]["speaker"], "森川 陽介");
        assert_eq!(serde_json::to_value(Reading::Plain).unwrap()["kind"], "plain");
    }
}
