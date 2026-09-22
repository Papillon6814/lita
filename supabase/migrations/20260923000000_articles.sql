-- v0.2: the app is made of three things — voices, articles, and an editor.
-- An article is one piece of writing with its own brief, voice, destination
-- and a history of versions. This replaces briefs + drafts (one brief per
-- generation, one draft per run), which modelled a single pass rather than
-- a document that lives on. Existing rows are carried over below.

-- ----- destinations ---------------------------------------------------------

insert into public.platforms (id, name, max_chars, rules) values
  ('note', 'note', null,
   'A long-form article for note.com. Plain text: a title on its own (returned separately), then paragraphs separated by blank lines. Use headings sparingly as a line starting with "## ". No markdown emphasis, no hashtags, no links unless the brief provides one.'),
  ('medium', 'Medium', null,
   'A long-form story for Medium. Plain text: a title (returned separately), then paragraphs separated by blank lines. Headings as lines starting with "## " where the argument turns. No markdown emphasis, no hashtags, no links unless the brief provides one.')
on conflict (id) do nothing;

-- ----- articles ------------------------------------------------------------

create table public.articles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  voice_id    uuid references public.voices (id) on delete set null,
  platform_id text not null references public.platforms (id),
  title       text not null default '',
  body        text not null default '',
  brief       text not null default '',
  status      text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index articles_user_id on public.articles (user_id, updated_at desc);
create index articles_voice_id on public.articles (voice_id);

create trigger articles_set_updated_at
  before update on public.articles
  for each row execute function public.set_updated_at();

alter table public.articles enable row level security;

create policy "articles: owner can do everything"
  on public.articles for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ----- versions ------------------------------------------------------------

-- A snapshot of an article's text. `kind` says what produced it:
--   generated  Codex wrote it from the brief
--   shortened  Codex rewrote a previous text to fit the limit
--   edited     the person's own editing (periodic / on close)
--   restored   the person went back to an earlier version
--   manual     the person asked to keep this state
create table public.article_versions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  article_id  uuid not null references public.articles (id) on delete cascade,
  kind        text not null check (kind in ('generated', 'shortened', 'edited', 'restored', 'manual')),
  title       text not null default '',
  body        text not null,
  prompt_sent text,                      -- for generated / shortened: exactly what went to Codex (B-08)
  elapsed_ms  integer,
  created_at  timestamptz not null default now()
);
create index article_versions_article_id on public.article_versions (article_id, created_at desc);
create index article_versions_user_id on public.article_versions (user_id);

alter table public.article_versions enable row level security;

create policy "article_versions: owner can do everything"
  on public.article_versions for all
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.articles a where a.id = article_id and a.user_id = auth.uid())
  );

-- Editing snapshots are frequent; keep only the latest 50 per article so the
-- table cannot grow without bound. Other kinds are kept.
create or replace function public.prune_edited_versions()
returns trigger
language plpgsql
as $$
begin
  delete from public.article_versions
  where article_id = new.article_id
    and kind = 'edited'
    and id in (
      select id from public.article_versions
      where article_id = new.article_id and kind = 'edited'
      order by created_at desc
      offset 50
    );
  return new;
end;
$$;

create trigger article_versions_prune
  after insert on public.article_versions
  for each row execute function public.prune_edited_versions();

-- ----- per-user settings ---------------------------------------------------

create table public.user_settings (
  user_id          uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  default_voice_id uuid references public.voices (id) on delete set null,
  updated_at       timestamptz not null default now()
);

create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

alter table public.user_settings enable row level security;

create policy "user_settings: owner can do everything"
  on public.user_settings for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ----- carry over briefs + drafts -----------------------------------------

-- One brief becomes one article; its drafts become versions; the latest
-- draft's text becomes the article body. An approved draft marks the
-- article approved; a brief whose drafts were all discarded is archived.
insert into public.articles (id, user_id, voice_id, platform_id, title, body, brief, status, created_at, updated_at)
select
  b.id,
  b.user_id,
  b.voice_id,
  b.platform_id,
  '',
  coalesce((select d.body from public.drafts d where d.brief_id = b.id order by d.created_at desc limit 1), ''),
  b.body,
  case
    when exists (select 1 from public.drafts d where d.brief_id = b.id and d.status = 'approved') then 'approved'
    when exists (select 1 from public.drafts d where d.brief_id = b.id and d.status = 'pending') then 'draft'
    when exists (select 1 from public.drafts d where d.brief_id = b.id) then 'archived'
    else 'draft'
  end,
  b.created_at,
  coalesce((select max(d.created_at) from public.drafts d where d.brief_id = b.id), b.created_at)
from public.briefs b;

insert into public.article_versions (user_id, article_id, kind, title, body, prompt_sent, elapsed_ms, created_at)
select d.user_id, d.brief_id, 'generated', '', d.body, d.prompt_sent, d.elapsed_ms, d.created_at
from public.drafts d;

drop table public.drafts;
drop table public.briefs;
