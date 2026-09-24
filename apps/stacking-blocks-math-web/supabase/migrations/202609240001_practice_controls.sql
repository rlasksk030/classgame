-- Teacher Page Expansion Phase 4C: per-lesson control over optional
-- practice ("유사 문제 풀기") and wrong-answer retry ("틀린 문제 다시
-- 풀기"). Backward compatible: both default true, matching existing
-- behavior exactly for every already-created row.
alter table public.sb_lesson_settings add column if not exists allow_similar boolean not null default true;
alter table public.sb_lesson_settings add column if not exists allow_retry boolean not null default true;
