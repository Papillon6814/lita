-- Lita schema, version 1 (2026-09-22).
--
-- Every row belongs to exactly one Supabase Auth user, and row level
-- security is the only access control: the desktop app talks to PostgREST
-- with the user's own JWT and can only ever see its own rows. Keep this file
-- plain SQL so it can be applied to any Postgres if we ever leave Supabase.

-- ---------------------------------------------------------------- helpers

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -------------------------------------------------------------- platforms
-- Output presets. Shared reference data, readable by any signed-in user,
-- writable by nobody through the API.

create table public.platforms (
  id        text primary key,            -- stable slug, e.g. 'x'
  name      text not null,
  max_chars integer,                     -- null means no hard limit
  rules     text not null default ''     -- plain-language rules handed to generation
);

alter table public.platforms enable row level security;

create policy "platforms are readable by signed-in users"
  on public.platforms for select
  to authenticated
  using (true);

insert into public.platforms (id, name, max_chars, rules) values
  ('x', 'X', 280,
   'A single post. No hashtags unless the brief asks for them. No links unless the brief provides one.');

-- ----------------------------------------------------------------- voices

create table public.voices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null,
  profile    jsonb not null,             -- lita_codex::voice::VoiceProfile, serialized as-is
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index voices_user_id on public.voices (user_id, created_at desc);

create trigger voices_set_updated_at
  before update on public.voices
  for each row execute function public.set_updated_at();

alter table public.voices enable row level security;

create policy "voices: owner can do everything"
  on public.voices for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------- voice_sources
-- The writing a voice was extracted from. Kept so the person can see what
-- their profile was built on. Never sent to generation (D-28).

create table public.voice_sources (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  voice_id   uuid not null references public.voices (id) on delete cascade,
  kind       text not null check (kind in ('paste', 'file')),
  origin     text,                       -- file name for 'file'; null for 'paste'
  body       text not null,
  created_at timestamptz not null default now()
);

create index voice_sources_voice_id on public.voice_sources (voice_id);
create index voice_sources_user_id on public.voice_sources (user_id);

alter table public.voice_sources enable row level security;

create policy "voice_sources: owner can do everything"
  on public.voice_sources for all
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.voices v where v.id = voice_id and v.user_id = auth.uid())
  );

-- ----------------------------------------------------------------- briefs

create table public.briefs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  voice_id    uuid not null references public.voices (id) on delete cascade,
  platform_id text not null references public.platforms (id),
  body        text not null,
  effort      text not null check (effort in ('fast', 'quality')),
  created_at  timestamptz not null default now()
);

create index briefs_voice_id on public.briefs (voice_id, created_at desc);
create index briefs_user_id on public.briefs (user_id, created_at desc);

alter table public.briefs enable row level security;

create policy "briefs: owner can do everything"
  on public.briefs for all
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.voices v where v.id = voice_id and v.user_id = auth.uid())
  );

-- ----------------------------------------------------------------- drafts

create table public.drafts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  brief_id    uuid not null references public.briefs (id) on delete cascade,
  body        text not null,
  prompt_sent text not null,             -- exactly what went to Codex, for the person to audit (B-08)
  model       text,                      -- as reported by Codex, if known
  elapsed_ms  integer not null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'discarded')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

create index drafts_brief_id on public.drafts (brief_id);
create index drafts_user_id on public.drafts (user_id, created_at desc);

alter table public.drafts enable row level security;

create policy "drafts: owner can do everything"
  on public.drafts for all
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.briefs b where b.id = brief_id and b.user_id = auth.uid())
  );
