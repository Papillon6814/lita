-- Learning sources as connections (#68): a piece remembers which account
-- it came from (note account, Medium handle; 'archive' for an X archive;
-- null for pasted text and files), so a voice can list its connections,
-- re-import new articles from one, or drop one.

alter table public.voice_sources add column account text;
create index voice_sources_voice_kind_account on public.voice_sources (voice_id, kind, account);
