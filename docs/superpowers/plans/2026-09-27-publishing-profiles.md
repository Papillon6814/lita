# Publishing Profiles Implementation Plan
> For agentic workers: use the approved requirements and UX spec; only `lita-dev` edits app code. Work in `feat/publishing-profiles`.
**Goal:** Isolate writing work by named Profile inside one Google login without losing existing data or interrupting other Profiles' queues.
**Architecture:** Add user-owned `publishing_profiles`, Profile ownership for Voices/Articles, `profile_settings` for policy/cloud, and `user_settings.active_profile_id` for one persisted selection. Backfill existing rows in place to an initial Profile without changing IDs or parent references. `UserStore` manages Profiles/user-wide queue; immutable `ProfileStore` scopes interactive operations; the queue uses each article's owner independent of the UI selection.
**Tech Stack:** PostgreSQL/Supabase RLS, Rust/Tauri/PostgREST, React/TypeScript, ja/en i18n.
---
## Contract and order
- Preserve current Google/Codex auth; never read Codex credentials or apply a migration to production without separate approval.
- Test first: migrate an existing user with Voices, sources, Articles, versions, policy/cloud, and queued work; assert unchanged IDs/content and one initial Profile. Then test cross-profile read/write isolation and queue owner pinning.
- Verify SQL in the user-approved isolated `/tmp/lita-profiles-fixture.*` PostgreSQL cluster, then stop and remove only that exact cluster. Trigger-disable/backfill requires one transaction: Supabase CLI v2.118 default migration batch has one Sync; for manual `psql` use `--single-transaction`, never bare `psql -f`. Never use production as a fixture.
- Test first: switch during dirty/saving/failed Editor states; only commit the selection after successful server save; no old Profile cache/route may flash after the switch.
- Implement and review in small serial slices: (1) migration + disposable DB proof, (2) ProfileStore contract + tests, (3) Tauri snapshots/queue + tests, (4) React UI/mock/i18n + UX review. No PR, push, Notion update or production DB push without separate approval.
## Files (one owner/writer per worktree)
- `supabase/migrations/20260927100000_publishing_profiles.sql`: create owned Profiles; backfill one Profile per existing user in place; migrate policy/cloud; add scoped FK/checks and indexes; preserve old row IDs and child relationships (review existing `20260923000000_articles.sql:18`, `20260922000000_init.sql:44`).
- `supabase/tests/publishing_profiles_migration.sql`: replay all six preceding migrations and fake users/rows; assert ID/reference preservation, GRANT/RLS, concurrent initialization and fail-closed preflight before any mutation.
- `crates/lita-store/src/lib.rs`: add Profile model/list/create/rename/select; scope `UserStore::voices` (`:283`), `articles` (`:421`), `settings` (`:540`) and mutations by Profile; constrain article/Voice associations on writes.
- `crates/lita-store/examples/roundtrip.rs`: extend round-trip coverage for two Profiles, surviving migration references, per-Profile policy/cloud and rejected cross-Profile IDs; never point this example at production without consent.
- `src-tauri/src/lib.rs`: profile commands and selected-profile initialization; scope all interactive commands; keep `run_queue` (`:1022`) independent of UI selection and bind `write_article` (`:592`) to the article's own Profile; test switch races and queue isolation.
- `src/platform/types.ts`: type Profile and selected-Profile responses.
- `src/platform/host.ts`: declare Profile operations and scoped host contract.
- `src/platform/tauri.ts`: bind new Tauri commands through the only allowed `@tauri-apps/*` import seam.
- `src/platform/mock.ts`: mock two independent Profiles plus migrated first Profile, creation, rename, save failure, and background queue scenes.
- `src/App.tsx`: load the selected Profile after Google sign-in and clear it on sign-out; mount `Shell` only after profile initialization.
- `src/components/Sidebar.tsx`: always-visible top Profile selector; name-on-create and rename with focus/escape; keep Google account menu separate.
- `src/components/Shell.tsx`: gate switching on Editor save, reset cross-Profile routes, remount scoped screens and retain the prior Profile on failure (`initialRoute` at `:27`).
- `src/components/Editor.tsx`: expose a trustworthy save-before-switch operation without losing its title/body/brief or version history.
- `src/hooks/useAutosave.ts`: make `flush` (`:50`) report settled success/failure even when a write is already in flight; preserve the existing local retry contract.
- `src/hooks/useQuietLoad.ts`: key or invalidate `VOICES_KEY` (`:24`) and other cached lists by Profile to prevent stale data leaking into the new view.
- `src/components/ArticleList.tsx`: show only selected Profile articles and queue status; keep old queue active in its own Profile.
- `src/components/VoiceSection.tsx`: list/build only selected Profile Voices and sources.
- `src/components/TopicPicker.tsx`: use only selected Profile policy, topic cloud, sources and article history; capture Profile when enqueuing.
- `src/i18n/ja.ts`: add approved Profile/create/rename/save-wait language.
- `src/i18n/en.ts`: provide matching English keys and meaning.
- `src/App.css`: style the top selector using existing tokens only.
- `docs/pm/requirements/2026-09-27-publishing-profiles.md`: acceptance contract (already drafted in Japanese).
- `docs/pm/ux/2026-09-27-publishing-profiles.md`: UX design and later mock-screen review (already drafted in Japanese).
- `docs/pm/dev/2026-09-27-publishing-profiles.md`: `lita-dev` evidence, focused tests, screenshot paths, migration risks and residual verification gaps.
## Verification
`cargo test --workspace && cargo clippy --workspace --all-targets && npm run build`
