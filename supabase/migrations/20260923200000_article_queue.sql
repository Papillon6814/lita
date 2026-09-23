-- Article queue (requirements 2026-09-23-article-queue): a queued article is
-- an ordinary draft with `queue` set. It clears when the text is written.
--   waiting  in line, body empty
--   writing  Codex is on it now (one at a time)
--   failed   Codex could not write it; the person can retry from the editor
-- Order is `created_at` (they are inserted in the order they were picked).

alter table public.articles
  add column queue text check (queue in ('waiting', 'writing', 'failed'));
create index articles_queue on public.articles (user_id, created_at) where queue is not null;

-- The editorial policy: one per person, four short free-text fields
-- (audience, takeaway, topics[], avoid). Empty is fine.
alter table public.user_settings
  add column policy jsonb not null default '{}'::jsonb;
