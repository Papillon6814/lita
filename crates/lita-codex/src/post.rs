//! Generating one post in a Voice. The profile is passed as a contract
//! (`generation_view`, D-28/D-29), the brief as the person wrote it, and
//! the platform's rules as plain language.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::voice::VoiceProfile;

/// What generation returns. `voice_notes` is for the person: one sentence
/// on which parts of the profile the draft leaned on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PostDraft {
    pub text: String,
    pub char_count: i64,
    pub voice_notes: String,
}

/// Output rules for one destination, as stored in `platforms`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlatformRules {
    pub name: String,
    pub max_chars: Option<i64>,
    pub rules: String,
}

pub fn post_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["text", "char_count", "voice_notes"],
        "properties": {
            "text": { "type": "string", "description": "The post, ready to publish as-is. No preamble, no quotes around it." },
            "char_count": { "type": "integer", "description": "The number of characters in `text`." },
            "voice_notes": { "type": "string", "description": "One sentence, in the same language as the post, on which parts of the profile the draft leaned on." }
        }
    })
}

/// The exact prompt sent to Codex. Shown to the person before sending (B-08),
/// so it must contain nothing the person would not want to see.
pub fn generation_prompt(profile: &VoiceProfile, brief: &str, platform: &PlatformRules) -> String {
    let limit = platform
        .max_chars
        .map(|n| format!("Stay under {n} characters.\n"))
        .unwrap_or_default();
    format!(
        "Write a single post for {name} in the voice described by this profile.\n\n\
         VOICE PROFILE:\n{profile}\n\n\
         BRIEF:\n{brief}\n\n\
         RULES FOR {name}:\n{rules}\n{limit}\
         Write in the profile's language ({language}). Match the profile's first person, \
         sentence endings, preferred words and emoji habit exactly; the profile is a contract, \
         not a suggestion. Do not explain the post, do not add hashtags or links unless the brief \
         asks for them. `char_count` is the character count of `text`.",
        name = platform.name,
        profile = serde_json::to_string_pretty(&profile.generation_view()).unwrap_or_default(),
        brief = brief.trim(),
        rules = platform.rules.trim(),
        language = profile.language,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voice::Excerpt;

    #[test]
    fn prompt_carries_brief_rules_and_limit_but_no_excerpts() {
        let profile = VoiceProfile {
            language: "ja".into(),
            first_person: "僕".into(),
            formality: "casual".into(),
            tone: vec![],
            sentence_endings: vec![],
            avg_sentence_length_chars: 30,
            preferred_words: vec![],
            avoided_words: vec![],
            opens_with: String::new(),
            closes_with: String::new(),
            uses_emoji: false,
            representative_excerpts: vec![Excerpt { excerpt: "SECRET-EXCERPT".into(), why: "".into() }],
            one_line: String::new(),
        };
        let p = generation_prompt(
            &profile,
            "v2 を告知",
            &PlatformRules { name: "X".into(), max_chars: Some(280), rules: "No hashtags.".into() },
        );
        assert!(p.contains("v2 を告知"));
        assert!(p.contains("No hashtags."));
        assert!(p.contains("under 280"));
        assert!(p.contains("(ja)"));
        assert!(!p.contains("SECRET-EXCERPT"));
    }
}
