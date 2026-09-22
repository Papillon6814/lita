//! Live check against note and Medium. Args: <note urlname> <medium handle>.

use lita_sources::{medium, note};

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let note_name = args.next().unwrap_or_else(|| "info".into());
    let medium_name = args.next().unwrap_or_else(|| "medium".into());

    let started = std::time::Instant::now();
    let (listing, pieces) = note::import(&note_name, 5)?;
    println!(
        "note @{note_name}: total={} free listed={} skipped_paid={} fetched={} in {:.1}s",
        listing.total_count, listing.notes.len(), listing.skipped_paid, pieces.len(), started.elapsed().as_secs_f32()
    );
    for p in pieces.iter().take(3) {
        println!("  - {:?} {} chars: {}", p.title, p.text.chars().count(), p.text.chars().take(60).collect::<String>().replace('\n', " "));
    }

    let started = std::time::Instant::now();
    let pieces = medium::import(&medium_name)?;
    println!("medium @{medium_name}: {} posts in {:.1}s", pieces.len(), started.elapsed().as_secs_f32());
    for p in pieces.iter().take(3) {
        println!("  - {:?} {} chars: {}", p.title, p.text.chars().count(), p.text.chars().take(60).collect::<String>().replace('\n', " "));
    }
    Ok(())
}
