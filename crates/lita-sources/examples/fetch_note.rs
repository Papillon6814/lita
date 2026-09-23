//! Saves a note.com account's public articles as Markdown files, one per
//! article, so extraction experiments can run on real material:
//! `cargo run -p lita-sources --example fetch_note -- <account> <dir> [max]`

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let account = args.next().expect("account");
    let dir = std::path::PathBuf::from(args.next().expect("output dir"));
    let max: usize = args.next().and_then(|s| s.parse().ok()).unwrap_or(20);
    std::fs::create_dir_all(&dir)?;
    let (listing, pieces) = lita_sources::note::import(&account, max)?;
    eprintln!("{} of {} articles ({} paid skipped)", pieces.len(), listing.total_count, listing.skipped_paid);
    for (i, p) in pieces.iter().enumerate() {
        let name = format!("{:02}.md", i + 1);
        let mut body = String::new();
        if let Some(t) = &p.title { body.push_str(&format!("# {t}\n\n")); }
        body.push_str(&p.text);
        std::fs::write(dir.join(&name), body)?;
        eprintln!("{name}: {} chars  {}", p.text.chars().count(), p.url.as_deref().unwrap_or(""));
    }
    Ok(())
}
