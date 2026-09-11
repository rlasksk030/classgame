alter table public.sb_problems add column if not exists source_type text not null default 'BUILT_IN'
  check (source_type in ('BUILT_IN','TEXTBOOK_STYLE','WORKSHEET_IMPORT','TEACHER_CREATED'));
