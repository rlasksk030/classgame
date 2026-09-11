alter table public.sb_lesson_settings add column if not exists practice_count smallint check (practice_count in (5,10,15,20));
alter table public.sb_student_progress add column if not exists practice_seed integer;
