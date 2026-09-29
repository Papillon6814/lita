\set ON_ERROR_STOP on
-- Isolated PostgreSQL 17 integration fixture. The runner creates auth roles/schema before invoking this file.
-- Pass all flags explicitly: bad_article, bad_settings, bad_source, bad_version (on/off).
-- Simulate a project opted out of automatic public-schema Data API grants.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
\if :bad_article
\set selected_voice '20000000-0000-0000-0000-000000000002'
\else
\set selected_voice '20000000-0000-0000-0000-000000000001'
\endif
\if :bad_settings
\set selected_default '20000000-0000-0000-0000-000000000002'
\else
\set selected_default '20000000-0000-0000-0000-000000000001'
\endif
\if :bad_source
\set selected_source_owner '10000000-0000-0000-0000-000000000002'
\else
\set selected_source_owner '10000000-0000-0000-0000-000000000001'
\endif
\if :bad_version
\set selected_draft_owner '10000000-0000-0000-0000-000000000002'
\else
\set selected_draft_owner '10000000-0000-0000-0000-000000000001'
\endif

create schema auth;
create table auth.users (id uuid primary key, email text unique);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
insert into auth.users (id, email) values
 ('10000000-0000-0000-0000-000000000001','existing@example.test'),
 ('10000000-0000-0000-0000-000000000002','second-owner@example.test');

-- Apply the exact six migrations already present before the publishing-profile migration.
\ir ../migrations/20260922000000_init.sql
insert into public.voices (id,user_id,name,profile) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','first voice','{"first_person":"one"}'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','second voice','{"first_person":"two"}');
\ir ../migrations/20260922100000_source_kinds.sql
\ir ../migrations/20260923100000_source_accounts.sql
insert into public.voice_sources (id,user_id,voice_id,kind,origin,body,account) values
 ('30000000-0000-0000-0000-000000000001',:'selected_source_owner','20000000-0000-0000-0000-000000000001','note','https://example.test/one','source one','one'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','paste',null,'source two',null);
insert into public.briefs (id,user_id,voice_id,platform_id,body,effort) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',:'selected_voice','x','existing brief','quality');
insert into public.drafts (id,user_id,brief_id,body,prompt_sent,elapsed_ms,status) values
 ('50000000-0000-0000-0000-000000000001',:'selected_draft_owner','40000000-0000-0000-0000-000000000001','existing draft','saved prompt',125,'pending');
\ir ../migrations/20260923000000_articles.sql
\ir ../migrations/20260923200000_article_queue.sql
\ir ../migrations/20260924100000_topic_cloud.sql
insert into public.user_settings (user_id,default_voice_id,policy,topic_cloud) values
 ('10000000-0000-0000-0000-000000000001',:'selected_default',
  '{"audience":"existing audience","takeaway":"existing takeaway","topics":["existing topic"],"avoid":"existing avoid"}',
  '{"words":[{"word":"existing cloud","weight":3,"written":true}],"gathered_at":"2026-09-27","material_count":2}');
update public.articles set queue='waiting' where id='40000000-0000-0000-0000-000000000001';
-- Preserve a pre-migration Writing attempt as unknown even though its Generated
-- Version predates a later brief edit that advances the mutable Article timestamp.
INSERT INTO public.articles (id,user_id,voice_id,platform_id,title,body,brief,status,created_at,updated_at,queue) VALUES
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',NULL,'x','legacy Writing title','generated body','original brief','draft',transaction_timestamp()-interval '2 hours',transaction_timestamp()-interval '2 hours','writing');
INSERT INTO public.article_versions (id,user_id,article_id,kind,title,body,prompt_sent,elapsed_ms,created_at) VALUES
 ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','generated','legacy Writing title','generated body','legacy prompt',100,transaction_timestamp()-interval '1 hour');
UPDATE public.articles SET brief='later brief edit' WHERE id='40000000-0000-0000-0000-000000000002';
CREATE TEMP TABLE before_profile_articles AS SELECT id,user_id,voice_id,platform_id,title,body,brief,status,queue,created_at,updated_at FROM public.articles;
CREATE TEMP TABLE before_profile_versions AS SELECT id,user_id,article_id,kind,title,body,prompt_sent,elapsed_ms,created_at FROM public.article_versions;

-- In anomaly modes, each old FK is legal in the previous schema but violates the new
-- ownership contract. The new migration must reject it before any persistent change.
\if :setup_only
\echo 'six-migration baseline fixture: ready'
\else
\ir ../migrations/20260927100000_publishing_profiles.sql
-- Supabase's normal authenticated Data API grants on pre-existing content tables;
-- this fixture opts out of blanket default grants, grant only the content-table operations tested here.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.voices TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.voice_sources TO authenticated;
GRANT SELECT ON TABLE public.articles, public.article_versions TO authenticated;

DO $$
DECLARE initial_id uuid; second_id uuid; profile_count integer; started_at timestamptz;
BEGIN
  SELECT id INTO initial_id FROM public.publishing_profiles WHERE user_id='10000000-0000-0000-0000-000000000001' AND is_initial;
  IF initial_id IS NULL THEN RAISE EXCEPTION 'missing initial Profile'; END IF;
  IF (SELECT count(*) FROM public.publishing_profiles WHERE is_initial) <> 2 THEN RAISE EXCEPTION 'expected exactly one initial Profile per existing user'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voices WHERE id='20000000-0000-0000-0000-000000000001' AND profile_id=initial_id AND name='first voice' AND profile->>'first_person'='one') THEN RAISE EXCEPTION 'Voice ID/content/ownership changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voice_sources WHERE id='30000000-0000-0000-0000-000000000001' AND profile_id=initial_id AND body='source one' AND account='one') THEN RAISE EXCEPTION 'source ID/content/ownership changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.articles WHERE id='40000000-0000-0000-0000-000000000001' AND profile_id=initial_id AND voice_id='20000000-0000-0000-0000-000000000001' AND brief='existing brief' AND queue='waiting') THEN RAISE EXCEPTION 'Article ID/content/Voice reference/queue changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.articles a JOIN public.article_versions v ON v.article_id=a.id WHERE a.id='40000000-0000-0000-0000-000000000002' AND a.profile_id=initial_id AND a.title='legacy Writing title' AND a.body='generated body' AND a.brief='later brief edit' AND a.queue='writing' AND a.queue_started_at IS NULL AND a.updated_at > v.created_at AND v.id='60000000-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'legacy Writing Article/version or unknown queue start was not preserved'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.article_versions WHERE article_id='40000000-0000-0000-0000-000000000001' AND profile_id=initial_id AND body='existing draft' AND prompt_sent='saved prompt') THEN RAISE EXCEPTION 'Article version or reference changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profile_settings WHERE profile_id=initial_id AND default_voice_id='20000000-0000-0000-0000-000000000001' AND policy->>'audience'='existing audience' AND topic_cloud->'words'->0->>'word'='existing cloud') THEN RAISE EXCEPTION 'existing settings not preserved'; END IF;
  IF (SELECT active_profile_id FROM public.user_settings WHERE user_id='10000000-0000-0000-0000-000000000001') <> initial_id THEN RAISE EXCEPTION 'active Profile not initialized'; END IF;
  IF EXISTS (SELECT * FROM before_profile_articles EXCEPT SELECT id,user_id,voice_id,platform_id,title,body,brief,status,queue,created_at,updated_at FROM public.articles) OR EXISTS (SELECT id,user_id,voice_id,platform_id,title,body,brief,status,queue,created_at,updated_at FROM public.articles EXCEPT SELECT * FROM before_profile_articles) THEN RAISE EXCEPTION 'Article IDs, references or contents changed'; END IF;
  IF EXISTS (SELECT * FROM before_profile_versions EXCEPT SELECT id,user_id,article_id,kind,title,body,prompt_sent,elapsed_ms,created_at FROM public.article_versions) OR EXISTS (SELECT id,user_id,article_id,kind,title,body,prompt_sent,elapsed_ms,created_at FROM public.article_versions EXCEPT SELECT * FROM before_profile_versions) THEN RAISE EXCEPTION 'version IDs, references or contents changed'; END IF;
  -- New attempts use database transaction time; ordinary edits retain it.
  INSERT INTO public.articles (id,user_id,profile_id,platform_id,queue) VALUES ('40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001',initial_id,'x','waiting');
  UPDATE public.articles SET queue='writing' WHERE id='40000000-0000-0000-0000-000000000003';
  SELECT a.queue_started_at INTO started_at FROM public.articles a WHERE a.id='40000000-0000-0000-0000-000000000003';
  IF started_at IS DISTINCT FROM transaction_timestamp() THEN RAISE EXCEPTION 'Waiting -> Writing did not use transaction_timestamp()'; END IF;
  UPDATE public.articles SET title='edited while Writing',body='edited body',brief='edited brief' WHERE id='40000000-0000-0000-0000-000000000003';
  IF (SELECT a.queue_started_at FROM public.articles a WHERE a.id='40000000-0000-0000-0000-000000000003') IS DISTINCT FROM started_at THEN RAISE EXCEPTION 'ordinary edits changed the queue start'; END IF;
  UPDATE public.articles SET queue='waiting' WHERE id='40000000-0000-0000-0000-000000000003';
  IF (SELECT queue_started_at FROM public.articles WHERE id='40000000-0000-0000-0000-000000000003') IS NOT NULL THEN RAISE EXCEPTION 'Writing -> Waiting did not clear the queue start'; END IF;
  UPDATE public.articles SET queue='writing' WHERE id='40000000-0000-0000-0000-000000000003';
  UPDATE public.articles SET queue='failed' WHERE id='40000000-0000-0000-0000-000000000003';
  IF (SELECT queue_started_at FROM public.articles WHERE id='40000000-0000-0000-0000-000000000003') IS NOT NULL THEN RAISE EXCEPTION 'Writing -> Failed did not clear the queue start'; END IF;
  UPDATE public.articles SET queue='writing' WHERE id='40000000-0000-0000-0000-000000000003';
  UPDATE public.articles SET queue=NULL WHERE id='40000000-0000-0000-0000-000000000003';
  IF (SELECT queue_started_at FROM public.articles WHERE id='40000000-0000-0000-0000-000000000003') IS NOT NULL THEN RAISE EXCEPTION 'Writing -> null did not clear the queue start'; END IF;
  UPDATE public.articles SET brief='legacy Writing post-migration edit' WHERE id='40000000-0000-0000-0000-000000000002';
  IF (SELECT queue_started_at FROM public.articles WHERE id='40000000-0000-0000-0000-000000000002') IS NOT NULL THEN RAISE EXCEPTION 'ordinary edit changed a legacy NULL queue start'; END IF;

  INSERT INTO public.publishing_profiles(user_id,name,is_initial) VALUES ('10000000-0000-0000-0000-000000000001','Second profile',false) RETURNING id INTO second_id;
  IF NOT EXISTS (SELECT 1 FROM public.profile_settings WHERE profile_id=second_id AND user_id='10000000-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'new named Profile did not atomically get settings'; END IF;
  BEGIN
    UPDATE public.articles SET profile_id=second_id WHERE id='40000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'cross-Profile Article/Voice reference unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.article_versions(user_id,article_id,profile_id,kind,body) VALUES ('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',second_id,'edited','bad');
    RAISE EXCEPTION 'cross-Profile version unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.voice_sources(user_id,voice_id,profile_id,kind,body) VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',second_id,'paste','bad');
    RAISE EXCEPTION 'cross-Profile source unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    UPDATE public.profile_settings SET default_voice_id='20000000-0000-0000-0000-000000000001' WHERE profile_id=second_id;
    RAISE EXCEPTION 'cross-Profile default Voice unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;

  INSERT INTO public.publishing_profiles(user_id,name,is_initial) VALUES ('10000000-0000-0000-0000-000000000001','Third profile',false);
  SELECT count(*) INTO profile_count FROM public.publishing_profiles WHERE user_id='10000000-0000-0000-0000-000000000001' AND NOT is_initial;
  IF profile_count <> 2 THEN RAISE EXCEPTION 'multiple named noninitial Profiles not allowed'; END IF;
  -- RPC atomically updates JSON and replaces sources within the exact Profile.
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
  PERFORM public.replace_profile_voice_sources(
    '20000000-0000-0000-0000-000000000001', initial_id,
    '{"first_person":"updated"}',
    '[{"kind":"paste","body":"replacement source"}]'::jsonb
  );
  IF NOT EXISTS (SELECT 1 FROM public.voices WHERE id='20000000-0000-0000-0000-000000000001' AND profile->>'first_person'='updated')
     OR NOT EXISTS (SELECT 1 FROM public.voice_sources WHERE voice_id='20000000-0000-0000-0000-000000000001' AND profile_id=initial_id AND kind='paste' AND body='replacement source')
     OR (SELECT count(*) FROM public.voice_sources WHERE voice_id='20000000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'RPC successful replacement did not update Voice and replace sources';
  END IF;
  BEGIN
    PERFORM public.replace_profile_voice_sources(
      '20000000-0000-0000-0000-000000000001', second_id,
      '{"first_person":"wrong profile"}', '[{"kind":"paste","body":"bad"}]'::jsonb
    );
    RAISE EXCEPTION 'RPC accepted a Voice from another Profile';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.replace_profile_voice_sources(
      '20000000-0000-0000-0000-000000000001', initial_id,
      '{"first_person":"must roll back"}', '[{"kind":"invalid","body":"bad"}]'::jsonb
    );
    RAISE EXCEPTION 'RPC accepted a source with invalid kind';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF NOT EXISTS (SELECT 1 FROM public.voices WHERE id='20000000-0000-0000-0000-000000000001' AND profile->>'first_person'='updated')
     OR NOT EXISTS (SELECT 1 FROM public.voice_sources WHERE voice_id='20000000-0000-0000-0000-000000000001' AND profile_id=initial_id AND kind='paste' AND body='replacement source') THEN
    RAISE EXCEPTION 'failed RPC did not roll back Voice JSON and old source set';
  END IF;

END $$;

-- New Auth users get an initial Profile and settings; repeat initialization is idempotent.
INSERT INTO auth.users(id,email) VALUES ('10000000-0000-0000-0000-000000000003','new@example.test');
SELECT public.ensure_initial_publishing_profile('10000000-0000-0000-0000-000000000003');
SELECT public.ensure_initial_publishing_profile('10000000-0000-0000-0000-000000000003');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.publishing_profiles WHERE user_id='10000000-0000-0000-0000-000000000003' AND is_initial) <> 1 THEN RAISE EXCEPTION 'initialization not idempotent'; END IF;
  IF (SELECT count(*) FROM public.profile_settings ps JOIN public.publishing_profiles p ON p.id=ps.profile_id WHERE p.user_id='10000000-0000-0000-0000-000000000003') <> 1 THEN RAISE EXCEPTION 'new user missing profile settings'; END IF;
END $$;
-- Exercise the Data API privilege/RLS path; deliberately do not grant privileges here.
SET ROLE authenticated;
SET request.jwt.claim.sub = '10000000-0000-0000-0000-000000000001';
DO $$
DECLARE initial_id uuid;
BEGIN
  SELECT id INTO initial_id FROM public.publishing_profiles
    WHERE user_id=auth.uid() AND is_initial;
  PERFORM public.replace_profile_voice_sources(
    '20000000-0000-0000-0000-000000000001', initial_id,
    '{"first_person":"authenticated replacement"}',
    '[{"kind":"paste","body":"authenticated replacement source"}]'::jsonb
  );
  IF NOT EXISTS (SELECT 1 FROM public.voices WHERE id='20000000-0000-0000-0000-000000000001' AND profile_id=initial_id AND profile->>'first_person'='authenticated replacement')
     OR NOT EXISTS (SELECT 1 FROM public.voice_sources WHERE voice_id='20000000-0000-0000-0000-000000000001' AND profile_id=initial_id AND kind='paste' AND body='authenticated replacement source')
     OR (SELECT count(*) FROM public.voice_sources WHERE voice_id='20000000-0000-0000-0000-000000000001' AND profile_id=initial_id) <> 1 THEN
    RAISE EXCEPTION 'authenticated RPC replacement did not update Voice and replace its Profile source set';
  END IF;
  BEGIN
    PERFORM public.replace_profile_voice_sources(
      '20000000-0000-0000-0000-000000000001', initial_id,
      '{"first_person":"should roll back"}', '[{"kind":"invalid","body":"invalid source"}]'::jsonb
    );
    RAISE EXCEPTION 'authenticated RPC accepted invalid source kind';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF NOT EXISTS (SELECT 1 FROM public.voices WHERE id='20000000-0000-0000-0000-000000000001' AND profile_id=initial_id AND profile->>'first_person'='authenticated replacement')
     OR NOT EXISTS (SELECT 1 FROM public.voice_sources WHERE voice_id='20000000-0000-0000-0000-000000000001' AND profile_id=initial_id AND kind='paste' AND body='authenticated replacement source')
     OR (SELECT count(*) FROM public.voice_sources WHERE voice_id='20000000-0000-0000-0000-000000000001' AND profile_id=initial_id) <> 1 THEN
    RAISE EXCEPTION 'authenticated failed RPC did not preserve Voice JSON and prior sources';
  END IF;
  DELETE FROM public.voices WHERE id='20000000-0000-0000-0000-000000000001' AND profile_id=initial_id;
  IF (SELECT voice_id FROM public.articles WHERE id='40000000-0000-0000-0000-000000000001') IS NOT NULL THEN RAISE EXCEPTION 'deleting Voice did not clear only Article voice_id'; END IF;
  IF (SELECT profile_id FROM public.articles WHERE id='40000000-0000-0000-0000-000000000001') <> initial_id THEN RAISE EXCEPTION 'deleting Voice cleared Profile ownership'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.article_versions WHERE article_id='40000000-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'Voice deletion lost versions'; END IF;
  IF (SELECT default_voice_id FROM public.profile_settings WHERE profile_id=initial_id) IS NOT NULL THEN RAISE EXCEPTION 'deleting Voice did not clear only default_voice_id'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.publishing_profiles WHERE is_initial) THEN RAISE EXCEPTION 'authenticated Profile SELECT failed'; END IF;
END $$;
INSERT INTO public.publishing_profiles(name) VALUES ('API grant test') RETURNING id \gset api_
SELECT set_config('fixture.api_profile_id', :'api_id', false);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profile_settings WHERE profile_id=current_setting('fixture.api_profile_id')::uuid) THEN RAISE EXCEPTION 'authenticated Profile INSERT did not create settings in the same request'; END IF;
END $$;
UPDATE public.publishing_profiles SET name='API grant test renamed' WHERE id=:'api_id';
UPDATE public.profile_settings SET policy='{"audience":"grant test"}' WHERE profile_id=:'api_id';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.publishing_profiles WHERE id=current_setting('fixture.api_profile_id')::uuid AND name='API grant test renamed') THEN RAISE EXCEPTION 'authenticated Profile INSERT/UPDATE failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profile_settings WHERE profile_id=current_setting('fixture.api_profile_id')::uuid AND policy->>'audience'='grant test') THEN RAISE EXCEPTION 'authenticated profile_settings INSERT/UPDATE failed'; END IF;
  BEGIN
    INSERT INTO public.publishing_profiles(user_id,name) VALUES ('10000000-0000-0000-0000-000000000002','cross-owner Profile');
    RAISE EXCEPTION 'cross-owner Profile unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.publishing_profiles WHERE id=current_setting('fixture.api_profile_id')::uuid;
    RAISE EXCEPTION 'authenticated DELETE unexpectedly granted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;
SET ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM id FROM public.publishing_profiles LIMIT 1;
    RAISE EXCEPTION 'anon unexpectedly read publishing_profiles';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT has_table_privilege('authenticated','public.publishing_profiles','SELECT') OR NOT has_table_privilege('authenticated','public.publishing_profiles','INSERT') OR NOT has_table_privilege('authenticated','public.publishing_profiles','UPDATE') THEN RAISE EXCEPTION 'missing authenticated Profile GRANT'; END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid='public.replace_profile_voice_sources(uuid,uuid,jsonb,jsonb)'::regprocedure) THEN RAISE EXCEPTION 'replacement RPC must run as invoker'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.voices'::regclass) OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.voice_sources'::regclass) THEN RAISE EXCEPTION 'Voice/source RLS was disabled'; END IF;
  IF has_function_privilege('anon','public.replace_profile_voice_sources(uuid,uuid,jsonb,jsonb)','EXECUTE') OR has_function_privilege('service_role','public.replace_profile_voice_sources(uuid,uuid,jsonb,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'RPC EXECUTE granted to forbidden role'; END IF;
  IF NOT has_function_privilege('authenticated','public.replace_profile_voice_sources(uuid,uuid,jsonb,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'RPC EXECUTE missing for authenticated'; END IF;
  IF has_table_privilege('authenticated','public.publishing_profiles','DELETE') OR has_table_privilege('authenticated','public.profile_settings','DELETE') THEN RAISE EXCEPTION 'DELETE GRANT exists'; END IF;
  IF has_table_privilege('anon','public.publishing_profiles','SELECT') OR has_table_privilege('anon','public.profile_settings','SELECT') THEN RAISE EXCEPTION 'anon GRANT exists'; END IF;
  IF has_table_privilege('service_role','public.publishing_profiles','SELECT') THEN RAISE EXCEPTION 'opt-out default GRANT was not removed'; END IF;
  IF EXISTS (SELECT 1 FROM public.publishing_profiles WHERE name='cross-owner Profile') THEN RAISE EXCEPTION 'cross-owner Profile persisted'; END IF;
END $$;
\echo 'publishing profiles migration fixture: PASS'
\endif
