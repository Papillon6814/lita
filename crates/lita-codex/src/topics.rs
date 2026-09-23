//! Titles to write next, and the editorial policy behind them (article
//! queue, 2026-09-23). Neither touches the generation contract in `post`:
//! what the queue learns here reaches an article only through its brief.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// The editorial policy: one per person, four short free-text fields. What
/// to write about, as opposed to the voice (how to write). All may be empty.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Policy {
    /// Who the writing is for.
    #[serde(default)]
    pub audience: String,
    /// What a reader should take away.
    #[serde(default)]
    pub takeaway: String,
    /// Subjects this person keeps returning to (at most three).
    #[serde(default)]
    pub topics: Vec<String>,
    /// What never gets written about.
    #[serde(default)]
    pub avoid: String,
}

impl Policy {
    pub fn is_empty(&self) -> bool {
        self.audience.trim().is_empty()
            && self.takeaway.trim().is_empty()
            && self.topics.iter().all(|t| t.trim().is_empty())
            && self.avoid.trim().is_empty()
    }

    /// The policy as lines for a prompt or a brief; nothing when empty.
    fn lines(&self, lang: Lang) -> Vec<String> {
        let mut out = Vec::new();
        let (a, t, s, v) = match lang {
            Lang::Ja => ("誰に向けて", "持ち帰ってほしいこと", "よく書く題材", "触れないこと"),
            Lang::En => ("Written for", "What the reader should take away", "Usual subjects", "Never about"),
        };
        if !self.audience.trim().is_empty() {
            out.push(format!("{a}: {}", self.audience.trim()));
        }
        if !self.takeaway.trim().is_empty() {
            out.push(format!("{t}: {}", self.takeaway.trim()));
        }
        let topics: Vec<&str> = self.topics.iter().map(|x| x.trim()).filter(|x| !x.is_empty()).collect();
        if !topics.is_empty() {
            out.push(format!("{s}: {}", topics.join("、")));
        }
        if !self.avoid.trim().is_empty() {
            out.push(format!("{v}: {}", self.avoid.trim()));
        }
        out
    }
}

/// Which language the brief is written in. Follows the voice's profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Ja,
    En,
}

impl Lang {
    pub fn of(profile_language: &str) -> Self {
        if profile_language.trim().to_lowercase().starts_with("en") { Lang::En } else { Lang::Ja }
    }
}

/// An article the person already has: its title and first line, so new
/// titles do not repeat it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Existing {
    pub title: String,
    pub first_line: String,
}

/// What the suggestion call returns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Topics {
    pub topics: Vec<String>,
}

pub fn topics_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["topics"],
        "properties": {
            "topics": {
                "type": "array",
                "description": "Titles the person could write next, one string each. Titles only: no subtitles, no explanation, no numbering.",
                "items": { "type": "string" }
            }
        }
    })
}

/// How much of each sample reaches a prompt. Titles need the person's
/// subjects, not their every sentence.
const SAMPLE_HEAD_CHARS: usize = 400;
const MAX_SAMPLES: usize = 24;

fn samples_block(samples: &[&str]) -> String {
    samples
        .iter()
        .filter(|s| !s.trim().is_empty())
        .take(MAX_SAMPLES)
        .enumerate()
        .map(|(i, s)| {
            let head: String = s.trim().chars().take(SAMPLE_HEAD_CHARS).collect();
            format!("--- {} ---\n{head}", i + 1)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn existing_block(existing: &[Existing]) -> String {
    existing
        .iter()
        .filter(|e| !e.title.trim().is_empty() || !e.first_line.trim().is_empty())
        .map(|e| {
            let title = if e.title.trim().is_empty() { "(no title)" } else { e.title.trim() };
            let line: String = e.first_line.trim().chars().take(80).collect();
            if line.is_empty() { format!("- {title}") } else { format!("- {title} — {line}") }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The prompt that asks for `n` titles. `direction` is the person's one
/// line for this round ("今回は採用寄りで") and may be empty.
pub fn topics_prompt(policy: &Policy, samples: &[&str], existing: &[Existing], direction: &str, n: usize, lang: Lang) -> String {
    let policy_lines = policy.lines(lang);
    let policy_block = if policy_lines.is_empty() {
        "(none written yet: infer the subjects from the writing samples)".to_string()
    } else {
        policy_lines.join("\n")
    };
    let direction = direction.trim();
    let direction_block = if direction.is_empty() { String::new() } else { format!("\nDIRECTION FOR THIS ROUND (weigh it heavily):\n{direction}\n") };
    let existing_block = existing_block(existing);
    let existing_block = if existing_block.is_empty() { "(none yet)".to_string() } else { existing_block };
    let language = match lang {
        Lang::Ja => "Japanese",
        Lang::En => "English",
    };
    format!(
        "Suggest {n} titles for articles this person could write next, in their own field and from their own \
         experience. The person will pick a few and have them written.\n\n\
         EDITORIAL POLICY (what to write about; the voice is handled elsewhere):\n{policy_block}\n\
         {direction_block}\n\
         WRITING SAMPLES BY THIS PERSON (their subjects and stance; do not copy their titles):\n{samples}\n\n\
         ALREADY WRITTEN (do not repeat these or close variants):\n{existing}\n\n\
         Rules: each title is one line in {language}, concrete and specific, at most 30 characters in Japanese \
         or 12 words in English. It states a point or a question the person could argue from experience, not \
         a generic how-to, not a listicle, not news. No two titles cover the same ground. No titles that need \
         research the person has not done, no statistics, no other people's names or companies. Return exactly \
         {n} titles, most fitting first.",
        samples = samples_block(samples),
        existing = existing_block,
    )
}

pub fn policy_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["audience", "takeaway", "topics", "avoid"],
        "properties": {
            "audience": { "type": "string", "description": "Who the writing is for, in one short phrase." },
            "takeaway": { "type": "string", "description": "What a reader should take away, in one short sentence." },
            "topics": { "type": "array", "description": "Subjects this person keeps returning to: one to three short phrases.", "items": { "type": "string" } },
            "avoid": { "type": "string", "description": "What this writing never touches, in one short phrase. Empty if nothing stands out." }
        }
    })
}

/// The prompt that drafts a policy from the person's writing and articles.
/// The person edits the result; nothing is saved from here.
pub fn policy_prompt(samples: &[&str], existing: &[Existing], lang: Lang) -> String {
    let language = match lang {
        Lang::Ja => "Japanese",
        Lang::En => "English",
    };
    let existing_block = existing_block(existing);
    let existing_block = if existing_block.is_empty() { "(none yet)".to_string() } else { existing_block };
    format!(
        "Read this person's writing and draft their editorial policy: four short fields describing what they \
         write about (not how; the voice is handled elsewhere). Write it as the person would state it \
         themselves, in {language}, in plain words. Stay within what the writing shows; do not invent a \
         business or an audience it does not point to.\n\n\
         WRITING SAMPLES:\n{samples}\n\n\
         ARTICLES ALREADY WRITTEN:\n{existing}\n\n\
         `audience`: who this is for (one phrase). `takeaway`: what a reader should leave with (one sentence). \
         `topics`: one to three subjects that recur (short phrases). `avoid`: what the writing steers clear \
         of, if anything stands out; otherwise an empty string.",
        samples = samples_block(samples),
        existing = existing_block,
    )
}

/// What the brief suggestion returns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SuggestedBrief {
    pub brief: String,
}

pub fn brief_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["brief"],
        "properties": {
            "brief": { "type": "string", "description": "The brief: two to four short sentences in the person's language saying what the article is about, who it is for, and the two or three points it makes from the person's own experience. Plain prose, no headings, no bullets, no title line." }
        }
    })
}

/// The prompt that drafts a brief for one article from its title (#97).
/// The person edits the result before writing; nothing is saved from here.
pub fn brief_prompt(title: &str, policy: &Policy, samples: &[&str], existing: &[Existing], lang: Lang) -> String {
    let language = match lang {
        Lang::Ja => "Japanese",
        Lang::En => "English",
    };
    let policy_lines = policy.lines(lang);
    let policy_block = if policy_lines.is_empty() { "(none written yet)".to_string() } else { policy_lines.join("\n") };
    let existing_block = existing_block(existing);
    let existing_block = if existing_block.is_empty() { "(none yet)".to_string() } else { existing_block };
    format!(
        "Write the brief for an article this person is about to write, titled:\n{title}\n\n\
         A brief says what the article is about, who it is for, and the two or three points it makes. \
         Two to four short sentences in {language}, in the person's own words as if they wrote the note to \
         themselves. Draw the points from what their writing shows they know and think; do not invent \
         facts, figures or events, and do not add research. Do not repeat an article they already wrote.\n\n\
         EDITORIAL POLICY:\n{policy_block}\n\n\
         WRITING SAMPLES BY THIS PERSON:\n{samples}\n\n\
         ARTICLES ALREADY WRITTEN:\n{existing_block}",
        title = title.trim(),
        samples = samples_block(samples),
    )
}

/// The brief a queued article starts with. This is how the policy, the
/// direction, the length and the no-research rule reach generation without
/// changing `post::generation_prompt` (D-28/D-29/D-59). The person sees and
/// can edit it in the editor like any brief.
pub fn brief_for(title: &str, policy: &Policy, direction: &str, lang: Lang) -> String {
    let mut lines = Vec::new();
    let title = title.trim();
    let direction = direction.trim();
    match lang {
        Lang::Ja => {
            lines.push(format!("題: {title}"));
            lines.extend(policy.lines(lang));
            if !direction.is_empty() {
                lines.push(format!("今回の方向: {direction}"));
            }
            lines.push("長さ: 1,500〜3,000 字。".to_string());
            lines.push("外部の事実は調べず、自分の経験と意見の範囲で書く。数字や出来事を断定しない。".to_string());
        }
        Lang::En => {
            lines.push(format!("Title: {title}"));
            lines.extend(policy.lines(lang));
            if !direction.is_empty() {
                lines.push(format!("Direction this round: {direction}"));
            }
            lines.push("Length: 800 to 1,500 words.".to_string());
            lines.push("Do not research outside facts; write from your own experience and opinion, and do not assert figures or events.".to_string());
        }
    }
    lines.join("\n")
}

/// Drops titles already written (same text after trimming and case), drops
/// duplicates among the suggestions, and keeps at most `n`.
pub fn dedupe(titles: Vec<String>, existing: &[Existing], n: usize) -> Vec<String> {
    let norm = |s: &str| s.trim().to_lowercase().replace(char::is_whitespace, "");
    let taken: std::collections::HashSet<String> = existing.iter().map(|e| norm(&e.title)).filter(|t| !t.is_empty()).collect();
    let mut seen = std::collections::HashSet::new();
    titles
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .filter(|t| !taken.contains(&norm(t)))
        .filter(|t| seen.insert(norm(t)))
        .take(n)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn existing(title: &str) -> Existing {
        Existing { title: title.into(), first_line: String::new() }
    }

    #[test]
    fn dedupe_drops_written_titles_and_repeats() {
        let out = dedupe(
            vec!["資金繰りは週で見る".into(), " 資金繰りは週で見る ".into(), "撤退の基準".into(), "".into(), "採用の話".into()],
            &[existing("撤退の基準")],
            10,
        );
        assert_eq!(out, vec!["資金繰りは週で見る", "採用の話"]);
    }

    #[test]
    fn dedupe_keeps_at_most_n() {
        let out = dedupe((0..20).map(|i| format!("題 {i}")).collect(), &[], 10);
        assert_eq!(out.len(), 10);
    }

    #[test]
    fn brief_carries_policy_direction_length_and_no_research() {
        let policy = Policy { audience: "これから会社を買う経営者".into(), takeaway: String::new(), topics: vec!["資金繰り".into(), "".into()], avoid: "個別の会社名".into() };
        let b = brief_for("撤退の基準は、始める前に決める", &policy, "今回は採用寄りで", Lang::Ja);
        assert!(b.starts_with("題: 撤退の基準は、始める前に決める\n"));
        assert!(b.contains("誰に向けて: これから会社を買う経営者"));
        assert!(!b.contains("持ち帰ってほしいこと"));
        assert!(b.contains("よく書く題材: 資金繰り\n"));
        assert!(b.contains("今回の方向: 今回は採用寄りで"));
        assert!(b.contains("1,500〜3,000 字"));
        assert!(b.contains("調べず"));
    }

    #[test]
    fn empty_policy_still_makes_a_prompt_and_a_brief() {
        let p = Policy::default();
        assert!(p.is_empty());
        let prompt = topics_prompt(&p, &["資本政策の相談で最初に聞くのは"], &[], "", 10, Lang::Ja);
        assert!(prompt.contains("(none written yet"));
        assert!(prompt.contains("exactly 10 titles"));
        let b = brief_for("題", &p, "", Lang::Ja);
        assert_eq!(b.lines().count(), 3);
    }

    #[test]
    fn brief_prompt_carries_title_and_policy() {
        let policy = Policy { audience: "経営者".into(), ..Default::default() };
        let p = brief_prompt("撤退の基準は、始める前に決める", &policy, &["本文"], &[existing("前の記事")], Lang::Ja);
        assert!(p.contains("titled:\n撤退の基準は、始める前に決める"));
        assert!(p.contains("誰に向けて: 経営者"));
        assert!(p.contains("- 前の記事"));
        assert!(p.contains("Japanese"));
    }

    #[test]
    fn prompts_never_carry_credentials() {
        let p = topics_prompt(&Policy::default(), &["x"], &[existing("y")], "z", 10, Lang::En);
        crate::assert_no_credentials(&p);
        crate::assert_no_credentials(&policy_prompt(&["x"], &[], Lang::Ja));
    }
}
