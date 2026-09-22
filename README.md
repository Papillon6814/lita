# Lita

**Lita writes your posts, in your voice — using the Codex login you already have.**

Lita is a desktop app for people who publish. You hand it a one-line brief; it
returns a draft for X that sounds like you, not like a chatbot. You read it,
fix what you want, and copy it.

It does not ask you for an API key. It drives the [OpenAI Codex
CLI](https://developers.openai.com/codex/cli) you already signed into, so your
ChatGPT login stays where it is and Lita never touches your credentials.

> **Status: v0.1 works end to end, for the author.** Voice from your own
> writing → brief → draft → approve → copy is done and in daily use. There is
> no installer yet: you run it from source. See [Roadmap](#roadmap).

Site and privacy policy: <https://lita.muumoo.online/>

## Why

Most AI writing tools give you a blank box and a generic model. You end up
rewriting everything because it does not sound like you.

Lita inverts that. It learns a **Voice** from writing you have already done, and
treats that Voice as the contract every draft has to satisfy. The human job is
the brief and the approval, not the typing.

You do not need much: we measured it, and a Voice is essentially stable from
four pieces of writing. Twenty pieces you actually like beat five hundred
scraped ones, because nothing you dislike gets in.

## How it works

```
Your public writing ──▶ Voice ──┐
(note, Medium, X archive,       │
 or paste / a text file)        ├──▶ Codex CLI ──▶ Draft ──▶ you approve ──▶ clipboard
                                │
Brief ──────────────────────────┘
("what, for whom, what to take away")
```

1. **Point it at your writing.** Enter your note or Medium account and it pulls
   your public articles; drop in your X archive (`tweets.js`); or paste text.
   Pick the pieces you are happy with.
2. **Build a Voice.** Codex distils formality, tone, sentence endings, the
   words that are yours, and how you open and close, into a profile you can
   read and edit line by line. It also writes one sentence about your writing
   for the top of the screen.
3. **Write a brief.** A sentence or two: what to say, to whom, what they should
   take away.
4. **Write.** Lita runs `codex exec` with a JSON schema, so the draft comes
   back structured. You can see the exact prompt before it is sent, choose
   fast or careful, and stop a run.
5. **Judge.** Edit the draft, ask for a shorter rewrite if it runs over the
   platform limit, then copy it. Or write again, or throw it away.

## Design principles

- **Borrowed auth.** Lita spawns the Codex CLI as a subprocess. It never reads,
  stores, or refreshes your OpenAI tokens.
- **Honest about the network.** Before writing, the app shows you exactly what
  will be sent to Codex: the structured Voice and your brief, never your
  original excerpts.
- **The Voice is a document, not a black box.** Every field is visible and
  editable in the app.
- **Your data follows your login.** Voices, briefs and drafts are stored under
  your Lita account (Google sign-in, Supabase in Tokyo, row-level security) so
  they are there on another machine. No analytics, no crash reports. What is
  stored and where is spelled out in the
  [privacy policy](https://lita.muumoo.online/privacy.html). Self-hosting is
  one constant away: the Supabase URL and anon key live in
  `src-tauri/src/config.rs`.

## Requirements

- macOS (Windows and Linux are untested)
- [Codex CLI](https://developers.openai.com/codex/cli) installed and logged in
  (`codex login`)
- A Google account, for signing in to Lita

## Running from source

You need Rust (stable), Node.js 20+, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```
npm install
npm run tauri dev     # opens the app against the Vite dev server
npm run tauri build   # native bundle under src-tauri/target/release/bundle
npm run mock          # every screen in a plain browser: http://localhost:1430/?scene=voice
cargo test            # Rust unit tests
```

The repository is a Cargo workspace:

| Path | What |
| --- | --- |
| `crates/lita-codex` | drives the Codex CLI; owns the Voice profile and the prompts |
| `crates/lita-sources` | note, Medium and X archive import |
| `crates/lita-auth` | Google sign-in through Supabase, session in the OS keychain |
| `crates/lita-store` | data access through PostgREST with the user's token |
| `src-tauri` | the Tauri shell: commands only, logic lives in the crates |
| `src/` | React + TypeScript frontend; `src/platform/` is the only place that talks to Tauri |
| `supabase/` | schema migrations and auth config |
| `site/` | the homepage and privacy policy, published to GitHub Pages |

## Roadmap

| Version | Scope |
| --- | --- |
| **v0.1** (done) | Voice from note / Medium / X archive / paste · one Voice · brief → X post → approve → copy · fast/careful · prompt preview · shorter rewrite |
| v0.2 | Signed, notarised builds and a Homebrew cask · draft history and re-editing · multiple Voices · long-form output for note and Medium |
| Later | Publisher plugins (draft to platform) · other model backends |

Slack as a Voice source was investigated and shelved: Marketplace listing
requires ten active workspaces before review, which a personal OSS project
cannot meet.

## Specification

The working specification lives in Notion and is the source of truth. This
repository carries a summary and the day-to-day project state:

- [`docs/`](docs/) — how the spec is organised and where to find it
- [`docs/pm/`](docs/pm/) — decisions, backlog, state, session handoff, and the
  measurement notes behind the design

## Contributing

Lita is MIT licensed and open from day one. It is early: the most useful
contribution right now is an opinion. Open an issue if the design above is
wrong for how you publish.

## License

[MIT](LICENSE)
