-- Fail before any DDL or data mutation when legacy rows violate the ownership relations
-- that the composite Profile foreign keys below will enforce. Never repair by moving data.
DO $$
DECLARE
  r record;
BEGIN
  SELECT a.id, a.user_id AS row_owner, v.id AS voice_id, v.user_id AS voice_owner
    INTO r FROM public.articles a JOIN public.voices v ON v.id = a.voice_id
    WHERE a.voice_id IS NOT NULL AND a.user_id <> v.user_id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Publishing Profiles migration aborted: public.articles row % (owner %) references Voice % (owner %). Resolve this legacy cross-owner reference explicitly, then retry; this migration has not changed data or schema.', r.id, r.row_owner, r.voice_id, r.voice_owner
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT s.id, s.user_id AS row_owner, v.id AS voice_id, v.user_id AS voice_owner
    INTO r FROM public.voice_sources s JOIN public.voices v ON v.id = s.voice_id
    WHERE s.user_id <> v.user_id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Publishing Profiles migration aborted: public.voice_sources row % (owner %) belongs to Voice % (owner %). Resolve this legacy cross-owner reference explicitly, then retry; this migration has not changed data or schema.', r.id, r.row_owner, r.voice_id, r.voice_owner
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT v.id, v.user_id AS row_owner, a.id AS article_id, a.user_id AS article_owner
    INTO r FROM public.article_versions v JOIN public.articles a ON a.id = v.article_id
    WHERE v.user_id <> a.user_id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Publishing Profiles migration aborted: public.article_versions row % (owner %) belongs to Article % (owner %). Resolve this legacy cross-owner reference explicitly, then retry; this migration has not changed data or schema.', r.id, r.row_owner, r.article_id, r.article_owner
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT s.user_id AS row_owner, v.id AS voice_id, v.user_id AS voice_owner
    INTO r FROM public.user_settings s JOIN public.voices v ON v.id = s.default_voice_id
    WHERE s.default_voice_id IS NOT NULL AND s.user_id <> v.user_id LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Publishing Profiles migration aborted: public.user_settings row for owner % selects Voice % owned by user %. Resolve this legacy cross-owner reference explicitly, then retry; this migration has not changed data or schema.', r.row_owner, r.voice_id, r.voice_owner
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;


-- Each publishing Profile owns its voices, sources, articles, versions, queue and writing settings.
-- Backfill in place: primary keys and existing parent/child references are unchanged.

create table public.publishing_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  is_initial boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
-- Only one initial Profile per user. Any number of named noninitial Profiles are allowed.
create unique index publishing_profiles_one_initial
  on public.publishing_profiles (user_id) where is_initial;
create index publishing_profiles_user_id on public.publishing_profiles (user_id, created_at, id);

alter table public.publishing_profiles enable row level security;
create policy "publishing_profiles: owner can read"
  on public.publishing_profiles for select to authenticated using (user_id = auth.uid());
create policy "publishing_profiles: owner can create"
  on public.publishing_profiles for insert to authenticated with check (user_id = auth.uid());
create policy "publishing_profiles: owner can rename"
  on public.publishing_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Profile deletion is intentionally not exposed by this feature.
create function public.keep_profile_initial_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.is_initial is distinct from new.is_initial then
    raise exception 'Profile initial status cannot be changed' using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger publishing_profiles_initial_flag_immutable
  before update of is_initial on public.publishing_profiles
  for each row execute function public.keep_profile_initial_flag();

-- Existing users receive exactly one initial Profile. The partial unique index and
-- conflict inference make this safe when multiple initializers race.
insert into public.publishing_profiles (user_id, name, is_initial)
select id, 'Profile 1', true from auth.users
on conflict (user_id) where is_initial do nothing;

-- Profile ownership on parent rows.
ALTER TABLE public.voices DISABLE TRIGGER voices_set_updated_at;
alter table public.voices add column profile_id uuid;
update public.voices v
set profile_id = p.id
from public.publishing_profiles p
where p.user_id = v.user_id and p.is_initial;
ALTER TABLE public.voices ENABLE TRIGGER voices_set_updated_at;
alter table public.voices alter column profile_id set not null;
alter table public.voices
  add constraint voices_profile_owner_fk
  foreign key (profile_id, user_id) references public.publishing_profiles (id, user_id) on delete cascade;
alter table public.voices add constraint voices_id_profile_unique unique (id, profile_id);
create index voices_profile_created on public.voices (profile_id, created_at desc);

ALTER TABLE public.articles DISABLE TRIGGER articles_set_updated_at;
alter table public.articles add column profile_id uuid;
alter table public.articles add column queue_started_at timestamptz;
update public.articles a
set profile_id = p.id
from public.publishing_profiles p
where p.user_id = a.user_id and p.is_initial;
ALTER TABLE public.articles ENABLE TRIGGER articles_set_updated_at;
alter table public.articles alter column profile_id set not null;
alter table public.articles
  add constraint articles_profile_owner_fk
  foreign key (profile_id, user_id) references public.publishing_profiles (id, user_id) on delete cascade;
alter table public.articles add constraint articles_id_profile_unique unique (id, profile_id);
create index articles_profile_updated on public.articles (profile_id, updated_at desc);
create index articles_profile_queue on public.articles (profile_id, created_at) where queue is not null;

-- The queue start is internal recovery metadata. Existing Writing rows intentionally
-- remain NULL because their actual start time is unknown; never infer it from updated_at.
CREATE FUNCTION public.set_article_queue_started_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.queue = 'writing' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.queue_started_at := transaction_timestamp();
    ELSIF OLD.queue = 'writing' THEN
      NEW.queue_started_at := OLD.queue_started_at;
    ELSE
      NEW.queue_started_at := transaction_timestamp();
    END IF;
  ELSE
    NEW.queue_started_at := NULL;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER articles_set_queue_started_at
  BEFORE INSERT OR UPDATE OF queue ON public.articles
  FOR EACH ROW EXECUTE FUNCTION public.set_article_queue_started_at();
-- PostgreSQL 17 supports a column list for SET NULL: deleting a Voice clears only voice_id,
-- preserving the Article's Profile ownership.
alter table public.articles
  add constraint articles_voice_profile_fk
  foreign key (voice_id, profile_id) references public.voices (id, profile_id)
  on delete set null (voice_id);

-- Child rows inherit and are constrained to the exact parent Profile as well as its owner.
alter table public.voice_sources add column profile_id uuid;
update public.voice_sources s
set profile_id = v.profile_id
from public.voices v
where v.id = s.voice_id;
alter table public.voice_sources alter column profile_id set not null;
alter table public.voice_sources
  add constraint voice_sources_profile_owner_fk
  foreign key (profile_id, user_id) references public.publishing_profiles (id, user_id) on delete cascade;
alter table public.voice_sources
  add constraint voice_sources_voice_profile_fk
  foreign key (voice_id, profile_id) references public.voices (id, profile_id) on delete cascade;
create index voice_sources_profile_voice on public.voice_sources (profile_id, voice_id);

alter table public.article_versions add column profile_id uuid;
update public.article_versions v
set profile_id = a.profile_id
from public.articles a
where a.id = v.article_id;
alter table public.article_versions alter column profile_id set not null;
alter table public.article_versions
  add constraint article_versions_profile_owner_fk
  foreign key (profile_id, user_id) references public.publishing_profiles (id, user_id) on delete cascade;
alter table public.article_versions
  add constraint article_versions_article_profile_fk
  foreign key (article_id, profile_id) references public.articles (id, profile_id) on delete cascade;
create index article_versions_profile_article on public.article_versions (profile_id, article_id, created_at desc);

-- Keep the selected Profile per account; move writing settings into profile_settings.
alter table public.user_settings add column active_profile_id uuid;
-- Some accounts may not yet have settings; create their selector row before making it non-null.
insert into public.user_settings (user_id)
select id from auth.users
on conflict (user_id) do nothing;
update public.user_settings s
set active_profile_id = p.id
from public.publishing_profiles p
where p.user_id = s.user_id and p.is_initial;
alter table public.user_settings alter column active_profile_id set not null;
alter table public.user_settings
  add constraint user_settings_active_profile_owner_fk
  foreign key (active_profile_id, user_id) references public.publishing_profiles (id, user_id) on delete cascade;

create table public.profile_settings (
  profile_id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  default_voice_id uuid,
  policy jsonb not null default '{}'::jsonb,
  topic_cloud jsonb,
  updated_at timestamptz not null default now(),
  constraint profile_settings_profile_owner_fk
    foreign key (profile_id, user_id) references public.publishing_profiles (id, user_id) on delete cascade
);
create index profile_settings_user_id on public.profile_settings (user_id);
-- Preserve the existing values exactly on the initial Profile; create empty settings for users
-- who had no user_settings row before migration.
insert into public.profile_settings (profile_id, user_id, default_voice_id, policy, topic_cloud)
select p.id, p.user_id, s.default_voice_id, coalesce(s.policy, '{}'::jsonb), s.topic_cloud
from public.publishing_profiles p
left join public.user_settings s on s.user_id = p.user_id
where p.is_initial;
alter table public.profile_settings
  add constraint profile_settings_default_voice_profile_fk
  foreign key (default_voice_id, profile_id) references public.voices (id, profile_id)
  on delete set null (default_voice_id);
create trigger profile_settings_set_updated_at before update on public.profile_settings
  for each row execute function public.set_updated_at();

-- The old user-wide values now live only in profile_settings.
alter table public.user_settings drop column default_voice_id;
alter table public.user_settings drop column policy;
alter table public.user_settings drop column topic_cloud;

alter table public.profile_settings enable row level security;
create policy "profile_settings: profile owner can do everything"
  on public.profile_settings for all to authenticated
  using (user_id = auth.uid() and exists (
    select 1 from public.publishing_profiles p where p.id = profile_id and p.user_id = auth.uid()
  ))
  with check (user_id = auth.uid() and exists (
    select 1 from public.publishing_profiles p where p.id = profile_id and p.user_id = auth.uid()
  ));
-- New public tables need explicit Data API access; discard broad default grants and
-- permit only the operations used by the authenticated Profile/settings API.
REVOKE ALL ON TABLE public.publishing_profiles, public.profile_settings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.publishing_profiles, public.profile_settings TO authenticated;

-- Keep each Profile's settings row lifecycle atomic with Profile creation.
-- This function is SECURITY INVOKER (the default), so authenticated grants/RLS apply.
CREATE FUNCTION public.create_profile_settings_for_publishing_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profile_settings (profile_id, user_id)
  VALUES (NEW.id, NEW.user_id)
  ON CONFLICT (profile_id) DO NOTHING;
  RETURN NEW;
END
$$;
CREATE TRIGGER publishing_profiles_create_settings
  AFTER INSERT ON public.publishing_profiles
  FOR EACH ROW EXECUTE FUNCTION public.create_profile_settings_for_publishing_profile();

-- RLS provides the account boundary and filters every content relation by its Profile.
drop policy "voices: owner can do everything" on public.voices;
create policy "voices: profile owner can do everything" on public.voices for all to authenticated
  using (user_id = auth.uid() and exists (
    select 1 from public.publishing_profiles p where p.id = profile_id and p.user_id = auth.uid()
  ))
  with check (user_id = auth.uid() and exists (
    select 1 from public.publishing_profiles p where p.id = profile_id and p.user_id = auth.uid()
  ));

drop policy "voice_sources: owner can do everything" on public.voice_sources;
create policy "voice_sources: profile owner can do everything" on public.voice_sources for all to authenticated
  using (user_id = auth.uid() and exists (
    select 1 from public.publishing_profiles p where p.id = profile_id and p.user_id = auth.uid()
  ))
  with check (user_id = auth.uid() and exists (
    select 1 from public.publishing_profiles p where p.id = profile_id and p.user_id = auth.uid()
  ));

drop policy "articles: owner can do everything" on public.articles;
create policy "articles: profile owner can do everything" on public.articles for all to authenticated
  using (user_id = auth.uid() and exists (
    select 1 from public.publishing_profiles p where p.id = profile_id and p.user_id = auth.uid()
  ))
  with check (user_id = auth.uid() and exists (
    select 1 from public.publishing_profiles p where p.id = profile_id and p.user_id = auth.uid()
  ));

drop policy "article_versions: owner can do everything" on public.article_versions;
create policy "article_versions: profile owner can do everything" on public.article_versions for all to authenticated
  using (user_id = auth.uid() and exists (
    select 1 from public.articles a
    where a.id = article_versions.article_id
      and a.profile_id = article_versions.profile_id
      and a.user_id = auth.uid()
  ))
  with check (user_id = auth.uid() and exists (
    select 1 from public.articles a
    where a.id = article_versions.article_id
      and a.profile_id = article_versions.profile_id
      and a.user_id = auth.uid()
  ));

-- Active selection belongs to the signed-in user, not to any one Profile settings row.
drop policy "user_settings: owner can do everything" on public.user_settings;
create policy "user_settings: owner can do everything" on public.user_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Initialize the initial Profile and both settings rows whenever Supabase Auth creates a user.
-- SECURITY DEFINER is needed because Auth's insert must not depend on client RLS policies.
create or replace function public.ensure_initial_publishing_profile(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
begin
  insert into public.publishing_profiles (user_id, name, is_initial)
  values (p_user_id, 'Profile 1', true)
  on conflict (user_id) where is_initial
  do update set user_id = excluded.user_id
  returning id into v_profile_id;

  insert into public.user_settings (user_id, active_profile_id)
  values (p_user_id, v_profile_id)
  on conflict (user_id) do update
    set active_profile_id = coalesce(public.user_settings.active_profile_id, excluded.active_profile_id);

  insert into public.profile_settings (profile_id, user_id)
  values (v_profile_id, p_user_id)
  on conflict (profile_id) do nothing;

  return v_profile_id;
end
$$;
revoke all on function public.ensure_initial_publishing_profile(uuid) from public, anon, authenticated;

create or replace function public.on_auth_user_created_initial_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_initial_publishing_profile(new.id);
  return new;
end
$$;
revoke all on function public.on_auth_user_created_initial_profile() from public, anon, authenticated;
create trigger on_auth_user_created_initial_profile
  after insert on auth.users
  for each row execute function public.on_auth_user_created_initial_profile();

-- Re-extracting a Voice and replacing its source set must be one transaction.
-- Invoker rights preserve the caller's RLS visibility and write policies.
CREATE FUNCTION public.replace_profile_voice_sources(
  p_voice_id uuid,
  p_profile_id uuid,
  p_profile jsonb,
  p_sources jsonb
 ) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1 FROM public.voices
  WHERE id = p_voice_id AND profile_id = p_profile_id AND user_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voice is not owned by this Profile' USING ERRCODE = '42501';
  END IF;

  UPDATE public.voices SET profile = p_profile
  WHERE id = p_voice_id AND profile_id = p_profile_id AND user_id = auth.uid();

  DELETE FROM public.voice_sources
  WHERE voice_id = p_voice_id AND profile_id = p_profile_id AND user_id = auth.uid();

  INSERT INTO public.voice_sources (user_id, voice_id, profile_id, kind, origin, account, body)
  SELECT auth.uid(), p_voice_id, p_profile_id, source.kind, source.origin, source.account, source.body
  FROM jsonb_to_recordset(p_sources) AS source(
    kind text, origin text, account text, body text
  );
END
$$;
REVOKE ALL ON FUNCTION public.replace_profile_voice_sources(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.replace_profile_voice_sources(uuid, uuid, jsonb, jsonb) TO authenticated;
