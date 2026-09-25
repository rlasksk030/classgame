-- Stage-aware lesson resume (안내된 탐구 -> 문제풀기 -> 선택 문제): tracks whether
-- a student has moved past the guided-exploration page for a lesson, so a
-- returning student who already finished it is never shown it again. Additive,
-- backward compatible: existing rows default to false (guided not yet marked
-- complete), which is exactly correct for every row that existed before this
-- column did -- nobody's progress regresses or gets silently marked done.
alter table public.sb_student_progress add column if not exists guided_completed boolean not null default false;
