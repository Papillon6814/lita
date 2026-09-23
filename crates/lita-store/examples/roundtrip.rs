//! Live check for the store: sign in, then create → read → update → delete
//! a voice with sources, an article with versions, and the default-voice
//! setting, through RLS. Leaves nothing
//! behind. Needs LITA_SUPABASE_URL and LITA_SUPABASE_ANON_KEY; opens the
//! browser once for sign-in.

use anyhow::{Context, Result, ensure};
use lita_auth::SupabaseAuth;
use lita_codex::voice::{Excerpt, VoiceProfile};
use lita_store::{ArticlePatch, ArticleStatus, NewArticle, NewSource, NewVersion, SourceKind, Store, VersionKind};

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
        one_line: String::new(),
        ..Default::default()
    };
    let sources = vec![
        NewSource { kind: SourceKind::Paste, origin: None, account: None, body: "一つ目".into() },
        NewSource { kind: SourceKind::File, origin: Some("notes.txt".into()), account: None, body: "二つ目".into() },
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

    ensure!(platforms.iter().any(|p| p.id == "note") && platforms.iter().any(|p| p.id == "medium"), "long-form platforms missing");

    let article = me.create_article(&NewArticle {
        voice_id: Some(voice.id.clone()),
        platform_id: "x".into(),
        title: String::new(),
        body: String::new(),
        brief: "新機能の告知".into(),
        ..Default::default()
    })?;
    ensure!(article.status == ArticleStatus::Draft && article.body.is_empty());
    let v1 = me.create_version(&NewVersion {
        article_id: article.id.clone(),
        kind: VersionKind::Generated,
        title: String::new(),
        body: "出来た文".into(),
        prompt_sent: Some("the prompt".into()),
        elapsed_ms: Some(6600),
    })?;
    me.update_article(&article.id, &ArticlePatch { body: Some("出来た文を直した".into()), title: Some("題".into()), ..Default::default() })?;
    me.create_version(&NewVersion { article_id: article.id.clone(), kind: VersionKind::Edited, title: "題".into(), body: "出来た文を直した".into(), prompt_sent: None, elapsed_ms: None })?;
    let a2 = me.article(&article.id)?.context("article vanished")?;
    ensure!(a2.body == "出来た文を直した" && a2.title == "題" && a2.updated_at >= article.updated_at, "article update failed");
    let versions = me.versions(&article.id)?;
    ensure!(versions.len() == 2 && versions[0].kind == VersionKind::Edited && versions[1].id == v1.id, "versions wrong: {versions:?}");
    me.update_article(&article.id, &ArticlePatch { status: Some(ArticleStatus::Approved), ..Default::default() })?;
    let listed = me.articles(Some(ArticleStatus::Approved))?;
    ensure!(listed.iter().any(|a| a.id == article.id && a.excerpt == "出来た文を直した"), "approved list missing the article");
    ensure!(me.articles(Some(ArticleStatus::Archived))?.iter().all(|a| a.id != article.id), "archived list has the article");
    println!("article/versions ok");

    // Edited snapshots are pruned to the latest 50 per article.
    for i in 0..55 {
        me.create_version(&NewVersion { article_id: article.id.clone(), kind: VersionKind::Edited, title: String::new(), body: format!("e{i}"), prompt_sent: None, elapsed_ms: None })?;
    }
    let vs = me.versions(&article.id)?;
    let edited = vs.iter().filter(|v| v.kind == VersionKind::Edited).count();
    ensure!(edited == 50 && vs.iter().any(|v| v.id == v1.id), "prune wrong: {edited} edited, generated kept={}", vs.iter().any(|v| v.id == v1.id));
    println!("prune ok");

    me.set_default_voice(Some(&voice.id))?;
    ensure!(me.settings()?.default_voice_id.as_deref() == Some(voice.id.as_str()), "default voice not stored");
    me.set_default_voice(None)?;
    ensure!(me.settings()?.default_voice_id.is_none(), "default voice not cleared");
    println!("settings ok");

    let unknown = me.create_article(&NewArticle { voice_id: None, platform_id: "mastodon".into(), ..Default::default() });
    ensure!(unknown.is_err(), "unknown platform was accepted");

    ensure!(me.delete_voice(&voice.id)?, "delete reported nothing");
    let orphan = me.article(&article.id)?.context("article should survive voice deletion")?;
    ensure!(orphan.voice_id.is_none(), "voice_id should be null after the voice is deleted");
    ensure!(me.delete_article(&article.id)?, "article delete reported nothing");
    ensure!(me.version(&v1.id)?.is_none(), "versions did not cascade");
    ensure!(!me.delete_voice(&voice.id)?, "second delete should be a no-op");
    println!("delete + cascade ok");

    // Someone else's session must not see or touch these rows. Using the
    // anon key alone as a stand-in: RLS grants nothing to `anon`.
    let anon = store.as_user(&key);
    ensure!(anon.voices()?.is_empty(), "anon saw voices");
    println!("all good");
    Ok(())
}
