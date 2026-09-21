# Lita

**Lita writes your posts, in your voice — using the Codex login you already have.**

Lita is a local-first desktop app for people who publish. You hand it a one-line
brief; it returns a finished draft for X, note, or Medium that sounds like you,
not like a chatbot. You read it, approve it, and ship it.

It does not ask you for an API key. It drives the [OpenAI Codex
CLI](https://developers.openai.com/codex/cli) you already signed into, so your
ChatGPT login stays where it is and Lita never touches your credentials.

> **Status: pre-alpha.** Nothing here is usable yet. v0.1 is being specified and
> built in the open. See [Roadmap](#roadmap).

## Why

Most AI writing tools give you a blank box and a generic model. You end up
rewriting everything because it does not sound like you.

Lita inverts that. It learns a **Voice** from writing you have already done, and
treats that Voice as the contract every draft has to satisfy. The human job is
the brief and the approval, not the typing.

You do not need much: we measured it, and a voice profile is essentially stable
from four messages. Twenty pieces of writing you actually like will beat five
hundred scraped ones, because nothing you dislike gets in.

## How it works

```
Writing you like ──▶ Voice profile ──┐
(paste it, or drop a file)           │
                                     ├──▶ Codex CLI ──▶ Draft ──▶ you approve ──▶ export
Brief ───────────────────────────────┘
("announce the v2 launch, aimed at existing users")
```

1. **Hand it some writing.** Paste twenty things you have written and are happy
   with, or drop in a file.
2. **Build a Voice.** Codex distills tone, cadence, vocabulary, and structure
   into an editable profile. You correct anything it got wrong.
3. **Write a brief.** A sentence or two about what to say and who to say it to.
4. **Generate.** Lita shells out to `codex exec` with a JSON schema, so drafts
   come back structured instead of as loose prose.
5. **Approve and export.** Copy to clipboard or save as Markdown, formatted for
   the target platform.

## Design principles

- **Local-first.** Your drafts and Voices live in a SQLite file on your machine.
  No Lita server, no telemetry, no account.
- **Borrowed auth.** Lita spawns the Codex CLI as a subprocess. It never reads,
  stores, or refreshes your OpenAI tokens.
- **Honest about the network.** The app shows you exactly what leaves your
  machine before it leaves.
- **The Voice is a document, not a black box.** You can read it, edit it, and
  put it in version control.

## Requirements

- macOS, Windows, or Linux
- [Codex CLI](https://developers.openai.com/codex/cli) installed and logged in
  (`codex login`)

## Roadmap

| Version | Scope |
| --- | --- |
| **v0.1** | Paste your writing · one Voice · brief → X post → approve → copy |
| v0.2 | Multi-platform output (note, Medium) · Slack and article URLs as Voice sources |
| v0.3 | Multiple Voices · draft history and re-editing |
| Later | Publisher plugins (draft-to-platform), scheduled generation |

## Specification

The working specification lives in Notion and is the source of truth. This
repository carries a summary and the day-to-day project state:

- [`docs/`](docs/) — how the spec is organised and where to find it
- [`docs/pm/`](docs/pm/) — decisions, backlog, and session handoff notes

## Contributing

Lita is MIT licensed and open from day one. It is pre-alpha, so the most useful
contribution right now is an opinion: open an issue if the design above is wrong.

## License

[MIT](LICENSE)
