-- The words a person keeps writing about (requirements 2026-09-24-topic-cloud):
-- one per person, gathered by Codex from their writing, articles and policy.
-- { "words": [{ "word", "weight" (1-5), "written" }], "gathered_at", "material_count" }
alter table public.user_settings
  add column topic_cloud jsonb;
