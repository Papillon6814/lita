-- Voice sources can now come from a person's published writing (D-43).
-- `origin` holds the article URL for these kinds.

alter table public.voice_sources drop constraint voice_sources_kind_check;
alter table public.voice_sources
  add constraint voice_sources_kind_check
  check (kind in ('paste', 'file', 'note', 'medium', 'x'));
