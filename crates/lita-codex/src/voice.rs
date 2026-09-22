//! The Voice profile: what Lita knows about how one person writes.
//!
//! A Voice is stored with everything extraction produced, including verbatim
//! excerpts, because a person should be able to see what their profile was
//! built from. But generation receives only the structured fields. Measured
//! three runs per variant on 2026-09-22: with excerpts in the prompt the
//! model followed the `uses_emoji` flag 0/3 times and lifted whole sentences
//! from the samples; without them, 2/3–3/3 and no borrowed phrasing. Concrete
//! examples beat abstract description, and here that is the wrong way round.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// How one person writes, as extracted from their own writing.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct VoiceProfile {
    /// BCP-47 tag for the language the samples were written in.
    pub language: String,
    /// The pronoun they use for themselves, or empty if they avoid one.
    pub first_person: String,
    /// How formal the writing is, as a phrase a writer could follow.
    pub formality: String,
    /// Three to six adjectives.
    pub tone: Vec<String>,
    /// Sentence-ending forms they actually use, most frequent first.
    pub sentence_endings: Vec<String>,
    pub avg_sentence_length_chars: i64,
    /// Recurring words and phrases that feel like this person. The single
    /// most effective field at making output sound like them.
    pub preferred_words: Vec<String>,
    /// Kinds of wording they visibly steer away from.
    pub avoided_words: Vec<String>,
    pub opens_with: String,
    pub closes_with: String,
    pub uses_emoji: bool,
    /// Verbatim passages with what each reveals. Kept for the person to read;
    /// never sent to generation.
    pub representative_excerpts: Vec<Excerpt>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct Excerpt {
    pub excerpt: String,
    pub why: String,
}

impl VoiceProfile {
    /// The JSON Schema extraction must satisfy. Every field carries a
    /// description: without one, the first PoC got a paragraph where a
    /// pronoun was expected.
    pub fn extraction_schema() -> Value {
        json!({
            "type": "object",
            "additionalProperties": false,
            "required": [
                "language", "first_person", "formality", "tone", "sentence_endings",
                "avg_sentence_length_chars", "preferred_words", "avoided_words",
                "opens_with", "closes_with", "uses_emoji", "representative_excerpts"
            ],
            "properties": {
                "language": { "type": "string", "description":
                    "The language the samples are written in, as a BCP-47 tag such as ja or en." },
                "first_person": { "type": "string", "description":
                    "The pronoun this person uses for themselves, as a single word. Empty string if they avoid one." },
                "formality": { "type": "string", "description":
                    "How formal the writing is, in one short phrase a writer could follow." },
                "tone": { "type": "array", "items": { "type": "string" }, "description":
                    "Three to six short adjectives describing the voice." },
                "sentence_endings": { "type": "array", "items": { "type": "string" }, "description":
                    "The sentence-ending forms they actually use, most frequent first, each as it would appear in text." },
                "avg_sentence_length_chars": { "type": "integer", "description":
                    "Mean sentence length in characters." },
                "preferred_words": { "type": "array", "items": { "type": "string" }, "description":
                    "Words and phrases that recur and feel characteristic of this person." },
                "avoided_words": { "type": "array", "items": { "type": "string" }, "description":
                    "Kinds of wording this person visibly steers away from." },
                "opens_with": { "type": "string", "description":
                    "How they typically open a message, in one short phrase." },
                "closes_with": { "type": "string", "description":
                    "How they typically end a message, in one short phrase." },
                "uses_emoji": { "type": "boolean", "description":
                    "Whether emoji appear at all." },
                "representative_excerpts": {
                    "type": "array",
                    "description": "At most three short passages quoted verbatim, each with what it reveals.",
                    "items": {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["excerpt", "why"],
                        "properties": {
                            "excerpt": { "type": "string", "description": "Quoted verbatim." },
                            "why": { "type": "string", "description": "What this passage reveals about the voice." }
                        }
                    }
                }
            }
        })
    }

    /// The prompt that turns a person's writing into a profile.
    pub fn extraction_prompt(samples: &[&str]) -> String {
        let corpus = samples
            .iter()
            .map(|m| format!("- {m}"))
            .collect::<Vec<_>>()
            .join("\n");
        format!(
            "You are analysing one person's writing so that another writer can imitate it \
             convincingly. Below are things they wrote.\n\n{corpus}\n\n\
             Describe their voice, following every field description exactly. Be concrete and \
             specific to these samples: a generic description is useless. Write the descriptive \
             values in the same language as the samples."
        )
    }

    /// What generation sees: the structured fields and nothing else.
    pub fn generation_view(&self) -> Value {
        json!({
            "language": self.language,
            "first_person": self.first_person,
            "formality": self.formality,
            "tone": self.tone,
            "sentence_endings": self.sentence_endings,
            "avg_sentence_length_chars": self.avg_sentence_length_chars,
            "preferred_words": self.preferred_words,
            "avoided_words": self.avoided_words,
            "opens_with": self.opens_with,
            "closes_with": self.closes_with,
            "uses_emoji": self.uses_emoji,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> VoiceProfile {
        VoiceProfile {
            language: "ja".into(),
            first_person: "僕ら".into(),
            formality: "です・ます".into(),
            tone: vec!["率直".into()],
            sentence_endings: vec!["ました".into()],
            avg_sentence_length_chars: 30,
            preferred_words: vec!["結局は".into()],
            avoided_words: vec![],
            opens_with: "結論から".into(),
            closes_with: "次の行動".into(),
            uses_emoji: true,
            representative_excerpts: vec![Excerpt {
                excerpt: "x".into(),
                why: "y".into(),
            }],
        }
    }

    #[test]
    fn every_schema_property_has_a_description() {
        let schema = VoiceProfile::extraction_schema();
        for (name, prop) in schema["properties"].as_object().unwrap() {
            assert!(prop["description"].is_string(), "{name} has no description");
        }
    }

    #[test]
    fn schema_requires_every_property() {
        let schema = VoiceProfile::extraction_schema();
        let props: Vec<_> = schema["properties"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        let required: Vec<String> = schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().into())
            .collect();
        for p in &props {
            assert!(
                required.contains(p),
                "{p} is not required; OpenAI structured output needs it to be"
            );
        }
    }

    #[test]
    fn a_profile_round_trips_through_its_own_schema_shape() {
        let v = serde_json::to_value(sample()).unwrap();
        let back: VoiceProfile = serde_json::from_value(v).unwrap();
        assert_eq!(back, sample());
    }

    #[test]
    fn generation_never_sees_the_excerpts() {
        let view = sample().generation_view();
        assert!(view.get("representative_excerpts").is_none());
        assert_eq!(view["preferred_words"][0], "結局は");
    }
}
