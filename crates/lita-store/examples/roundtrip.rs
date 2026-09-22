//! Live check for the store: sign in, then create → read → update → delete
//! a voice with sources, a brief, and a draft, through RLS. Leaves nothing
//! behind. Needs LITA_SUPABASE_URL and LITA_SUPABASE_ANON_KEY; opens the
//! browser once for sign-in.

use anyhow::{Context, Result, ensure};
use lita_auth::SupabaseAuth;
use lita_codex::voice::{Excerpt, VoiceProfile};
use lita_store::{DraftStatus, NewBrief, NewDraft, NewSource, SourceKind, Store, StoredEffort};

fn main() -> Result<()> {
    let url = std::env::var("LITA_SUPABASE_URL").context("LITA_SUPABASE_URL is not set")?;
    let key = std::env::var("LITA_SUPABASE_ANON_KEY").context("LITA_SUPABASE_ANON_KEY is not set")?;
    let session = SupabaseAuth::new(&url, &key)?.sign_in_with_provider("google", |u| {
        std::process::Command::new("open").arg(u.as_str()).status()?;
        Ok(())
    })?;
    println!("signed in as {:?}", session.user.email);

    let store = Store::new(&url, &key)?;
    let me = store.as_user(&session.access_token);

    let platforms = me.platforms()?;
    ensure!(platforms.iter().any(|p| p.id == "x"), "platform x missing");
    println!("platforms ok: {}", platforms.len());

    let profile = VoiceProfile {
        language: "ja".into(),
        first_person: "僕".into(),
        formality: "casual".into(),
        tone: vec!["direct".into()],
        sentence_endings: vec!["です".into()],
        avg_sentence_length_chars: 30,
        preferred_words: vec!["ざっくり".into()],
        avoided_words: vec![],
        opens_with: String::new(),
        closes_with: String::new(),
        uses_emoji: false,
        representative_excerpts: vec![Excerpt { excerpt: "例".into(), why: "短い".into() }],
    };
    let sources = vec![
        NewSource { kind: SourceKind::Paste, origin: None, body: "一つ目".into() },
        NewSource { kind: SourceKind::File, origin: Some("notes.txt".into()), body: "二つ目".into() },
    ];
    let before = me.voices()?.len();
    let voice = me.create_voice("roundtrip", &profile, &sources)?;
    ensure!(voice.sources.len() == 2, "expected 2 sources, got {}", voice.sources.len());
    ensure!(voice.profile == profile, "profile did not round-trip");
    println!("voice ok: {}", voice.id);

    let list = me.voices()?;
    ensure!(list.len() == before + 1, "list did not grow");
    ensure!(list.iter().any(|v| v.id == voice.id && v.source_count == 2), "summary count wrong");

    me.rename_voice(&voice.id, "roundtrip renamed")?;
    let mut p2 = profile.clone();
    p2.uses_emoji = true;
    me.replace_voice_profile(&voice.id, &p2, &sources[..1])?;
    let v2 = me.voice(&voice.id)?.context("voice vanished")?;
    ensure!(v2.name == "roundtrip renamed" && v2.profile.uses_emoji && v2.sources.len() == 1, "update failed");
    println!("update ok");

    let brief = me.create_brief(&NewBrief {
        voice_id: voice.id.clone(),
        platform_id: "x".into(),
        body: "新機能の告知".into(),
        effort: StoredEffort::Fast,
    })?;
    let draft = me.create_draft(&NewDraft {
        brief_id: brief.id.clone(),
        body: "出来た文".into(),
        prompt_sent: "the prompt".into(),
        model: Some("gpt-5".into()),
        elapsed_ms: 6600,
    })?;
    ensure!(draft.status == DraftStatus::Pending && draft.decided_at.is_none());
    me.set_draft_status(&draft.id, DraftStatus::Approved)?;
    let d2 = me.draft(&draft.id)?.context("draft vanished")?;
    ensure!(d2.status == DraftStatus::Approved && d2.decided_at.is_some(), "approve failed");
    me.set_draft_status(&draft.id, DraftStatus::Pending)?;
    ensure!(me.draft(&draft.id)?.unwrap().decided_at.is_none(), "pending did not clear decided_at");
    ensure!(me.briefs_for_voice(&voice.id)?.len() == 1 && me.drafts_for_brief(&brief.id)?.len() == 1);
    println!("brief/draft ok");

    let unknown = me.create_brief(&NewBrief {
        voice_id: voice.id.clone(),
        platform_id: "mastodon".into(),
        body: "x".into(),
        effort: StoredEffort::Quality,
    });
    ensure!(unknown.is_err(), "unknown platform was accepted");

    ensure!(me.delete_voice(&voice.id)?, "delete reported nothing");
    ensure!(me.voice(&voice.id)?.is_none() && me.brief(&brief.id)?.is_none() && me.draft(&draft.id)?.is_none(), "cascade failed");
    ensure!(!me.delete_voice(&voice.id)?, "second delete should be a no-op");
    println!("delete + cascade ok");

    // Someone else's session must not see or touch these rows. Using the
    // anon key alone as a stand-in: RLS grants nothing to `anon`.
    let anon = store.as_user(&key);
    ensure!(anon.voices()?.is_empty(), "anon saw voices");
    println!("all good");
    Ok(())
}
