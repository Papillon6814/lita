# Lita — agent instructions

Lita is a local-first desktop app that drives the user's already-authenticated
Codex CLI to write publishing-ready posts in the user's own voice.

## Source of truth

The specification lives in **Notion** and Notion wins every disagreement:
https://www.notion.so/3e29cda8bea1809e9077d080a350d218

This repository carries a summary (`docs/`) and the project state (`docs/pm/`).

## The PM agent

This project has a dedicated product manager agent defined in
`.claude/agents/lita-pm.md`. Invoke it for anything about scope, priority,
specification, or recording a decision. It reads `docs/pm/` at the start of a
session and writes back at the end.

Do not make scope decisions without it. Do not re-litigate anything already
recorded in `docs/pm/decisions.md`.

## Non-negotiable constraints

1. **Never read, store, copy, or refresh the user's Codex/OpenAI credentials.**
   Lita spawns the `codex` binary and lets it handle its own auth. Reading
   `~/.codex/auth.json` is out of bounds.
2. **Never commit user content or secrets.** `*.sqlite`, `auth.json`, and `.env`
   are gitignored; keep it that way.
3. **Local-first.** No Lita-operated server, no telemetry, no account system.
4. **Scope discipline.** v0.1 is: paste writing → one Voice → brief → X post →
   approve → copy. Anything else goes in the backlog. Slack was deliberately
   cut from v0.1 — see `docs/pm/2026-09-22-slack-scopes.md` before proposing it
   back.

## Calling Codex from Lita

The intended invocation shape:

```
codex exec --json \
  --output-schema <schema.json> \
  --output-last-message <final.json> \
  --sandbox read-only \
  --skip-git-repo-check \
  --ephemeral \
  -
```

with the prompt on stdin. Notes:

- `codex exec` refuses to run outside a git repository unless
  `--skip-git-repo-check` is passed. Lita's working directory is not a repo.
- Approval requests fail a non-interactive run, so keep the sandbox read-only.
- `--json` turns stdout into a JSONL event stream; use it to drive progress UI.
- `--output-schema` enforces the shape of the final message. Schema validation
  can still fail, so treat it as fallible and retry.

Reference: https://developers.openai.com/codex/cli/reference

## Working agreement

- Code changes happen on a feature branch in a git worktree, never on `main`.
- Branch names: `feat/xxx`, `fix/xxx`, `refactor/xxx`.
- Merge to `main` with `--no-ff`.
- Project-facing docs and code are in English. `docs/pm/` is in Japanese.
