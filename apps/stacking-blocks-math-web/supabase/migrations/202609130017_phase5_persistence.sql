-- Phase 5 preparation only. This migration is additive and has not been
-- applied to any remote Supabase project.
-- Student requests continue to enter through Edge Functions using service_role;
-- no anon/authenticated table access is opened for student data.

begin;

-- 9차시: public card와 private grading source를 분리한 버전형 문제 게시물.
create table if not exists public.sb_student_created_problems (
  problem_id           uuid not null default gen_random_uuid(),
  version              integer not null check (version > 0),
  installation_id      text not null,
  class_id             uuid not null references public.sb_classes(id) on delete cascade,
  author_student_id    uuid not null references public.sb_students(id) on delete cascade,
  title                text not null default '',
  public_problem_json  jsonb not null default '{}'::jsonb,
  hidden_validation_json jsonb not null default '{}'::jsonb,
  hint_type            text not null check (hint_type in ('views','top','heightMap','layers')),
  status               text not null default 'draft' check (status in ('draft','published','hidden')),
  published_at         timestamptz,
  hidden_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  primary key (problem_id, version)
);

create index if not exists sb_student_created_problems_class_idx
  on public.sb_student_created_problems (installation_id, class_id, status, created_at desc);
create index if not exists sb_student_created_problems_author_idx
  on public.sb_student_created_problems (installation_id, author_student_id);

-- 9차시: 학생별 문제 버전당 한 번만 완료·점수를 반영한다.
create table if not exists public.sb_peer_problem_attempts (
  id                  uuid primary key default gen_random_uuid(),
  installation_id    text not null,
  class_id           uuid not null references public.sb_classes(id) on delete cascade,
  problem_id         uuid not null,
  problem_version    integer not null check (problem_version > 0),
  student_id         uuid not null references public.sb_students(id) on delete cascade,
  used_hint          boolean not null default false,
  submitted_answer_json jsonb not null default '{}'::jsonb,
  is_correct         boolean not null default false,
  score_awarded      smallint not null default 0 check (score_awarded between 0 and 2),
  completed_at       timestamptz,
  idempotency_key    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (installation_id, problem_id, problem_version, student_id),
  unique (installation_id, idempotency_key),
  foreign key (problem_id, problem_version)
    references public.sb_student_created_problems(problem_id, version)
    on delete cascade
);

create index if not exists sb_peer_problem_attempts_class_idx
  on public.sb_peer_problem_attempts (installation_id, class_id, problem_id);
create index if not exists sb_peer_problem_attempts_student_idx
  on public.sb_peer_problem_attempts (installation_id, student_id, created_at desc);

-- 12차시: 기존 lesson 집계와 별도로 문제별 최초/최종 결과를 보존한다.
create table if not exists public.sb_lesson_progress_records (
  installation_id       text not null,
  class_id              uuid not null references public.sb_classes(id) on delete cascade,
  student_id            uuid not null references public.sb_students(id) on delete cascade,
  curriculum_version    text not null,
  lesson                 smallint not null check (lesson between 1 and 12),
  stage                  text not null check (stage in ('learn','solve','practice')),
  set_id                 text not null,
  problem_id             text not null,
  problem_version        integer not null default 1 check (problem_version > 0),
  question_index         integer not null check (question_index >= 0),
  answer                 jsonb not null default '{}'::jsonb,
  first_attempt_result   text check (first_attempt_result in ('correct','incorrect')),
  attempt_count         integer not null default 0 check (attempt_count >= 0),
  hint_level             smallint not null default 0 check (hint_level >= 0),
  final_result           text check (final_result in ('correct','incorrect')),
  remediation_status     text not null default 'none' check (remediation_status in ('none','needed','complete')),
  completed_at           timestamptz,
  self_evaluation        jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  primary key (installation_id, class_id, student_id, lesson, set_id, problem_id, problem_version)
);

create index if not exists sb_lesson_progress_records_student_idx
  on public.sb_lesson_progress_records (installation_id, student_id, lesson, set_id, question_index);
create index if not exists sb_lesson_progress_records_class_idx
  on public.sb_lesson_progress_records (installation_id, class_id, lesson, remediation_status);

-- 12차시: 학생별 안정적인 seed/문항 목록 assignment. active set은 차시당 하나다.
create table if not exists public.sb_practice_assignments (
  assignment_id       uuid primary key default gen_random_uuid(),
  installation_id     text not null,
  class_id            uuid not null references public.sb_classes(id) on delete cascade,
  student_id          uuid not null references public.sb_students(id) on delete cascade,
  lesson              smallint not null check (lesson between 1 and 12),
  curriculum_version  text not null,
  set_id              text not null,
  seed                integer not null,
  problem_ids         jsonb not null default '[]'::jsonb,
  target_total        smallint not null check (target_total in (5,10,15,20)),
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  deactivated_at      timestamptz,
  unique (installation_id, student_id, lesson, set_id)
);

create unique index if not exists sb_practice_assignments_one_active_idx
  on public.sb_practice_assignments (installation_id, student_id, lesson)
  where active;
create index if not exists sb_practice_assignments_class_idx
  on public.sb_practice_assignments (installation_id, class_id, lesson, active);

-- 11차시: 현재 sb_projects 행(학생당 하나)을 project_id로 식별할 수 있게 한다.
-- 기존 행은 nullable 상태로 보존하며, 새 저장부터 기본 UUID를 사용한다.
alter table public.sb_projects
  add column if not exists project_id uuid default gen_random_uuid();
create unique index if not exists sb_projects_project_id_idx
  on public.sb_projects (project_id);

-- 11차시: PDF/PNG 바이너리는 Storage 단계에서 결정하고, 여기에는 버전 스냅샷 메타데이터만 둔다.
create table if not exists public.sb_project_exports (
  id                uuid primary key default gen_random_uuid(),
  installation_id   text not null,
  class_id          uuid not null references public.sb_classes(id) on delete cascade,
  student_id        uuid not null references public.sb_students(id) on delete cascade,
  project_id        uuid references public.sb_projects(project_id) on delete set null,
  project_version   integer not null check (project_version >= 0),
  export_type       text not null check (export_type in ('png','pdf')),
  snapshot_json     jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  unique (installation_id, student_id, project_id, project_version, export_type)
);

create index if not exists sb_project_exports_class_idx
  on public.sb_project_exports (installation_id, class_id, student_id, created_at desc);

-- 12차시 자기평가는 정답/점수 기록과 분리한다.
create table if not exists public.sb_student_lesson_reflections (
  installation_id    text not null,
  class_id           uuid not null references public.sb_classes(id) on delete cascade,
  student_id         uuid not null references public.sb_students(id) on delete cascade,
  lesson             smallint not null check (lesson between 1 and 12),
  curriculum_version text not null,
  confidence         smallint check (confidence between 1 and 5),
  favorite_concept   text,
  self_praise        text not null default '',
  updated_at         timestamptz not null default now(),
  primary key (installation_id, student_id, lesson, curriculum_version)
);

-- All new tables are RLS protected. Students never receive direct table grants;
-- the Edge Function uses service_role after validating the student session.
alter table public.sb_student_created_problems enable row level security;
alter table public.sb_peer_problem_attempts enable row level security;
alter table public.sb_lesson_progress_records enable row level security;
alter table public.sb_practice_assignments enable row level security;
alter table public.sb_project_exports enable row level security;
alter table public.sb_student_lesson_reflections enable row level security;

drop policy if exists sb_student_created_problems_teacher on public.sb_student_created_problems;
create policy sb_student_created_problems_teacher on public.sb_student_created_problems
  for select to authenticated using (public.sb_owns_class(class_id));
drop policy if exists sb_student_created_problems_teacher_update on public.sb_student_created_problems;
create policy sb_student_created_problems_teacher_update on public.sb_student_created_problems
  for update to authenticated using (public.sb_owns_class(class_id)) with check (public.sb_owns_class(class_id));

drop policy if exists sb_peer_problem_attempts_teacher on public.sb_peer_problem_attempts;
create policy sb_peer_problem_attempts_teacher on public.sb_peer_problem_attempts
  for select to authenticated using (public.sb_owns_class(class_id));
drop policy if exists sb_lesson_progress_records_teacher on public.sb_lesson_progress_records;
create policy sb_lesson_progress_records_teacher on public.sb_lesson_progress_records
  for select to authenticated using (public.sb_owns_class(class_id));
drop policy if exists sb_practice_assignments_teacher on public.sb_practice_assignments;
create policy sb_practice_assignments_teacher on public.sb_practice_assignments
  for select to authenticated using (public.sb_owns_class(class_id));
drop policy if exists sb_project_exports_teacher on public.sb_project_exports;
create policy sb_project_exports_teacher on public.sb_project_exports
  for select to authenticated using (public.sb_owns_class(class_id));
drop policy if exists sb_student_lesson_reflections_teacher on public.sb_student_lesson_reflections;
create policy sb_student_lesson_reflections_teacher on public.sb_student_lesson_reflections
  for select to authenticated using (public.sb_owns_class(class_id));

-- Explicitly expose only teacher read/update paths and server write paths.
grant select on public.sb_student_created_problems to authenticated;
grant update (status, hidden_at, updated_at) on public.sb_student_created_problems to authenticated;
grant select on public.sb_peer_problem_attempts to authenticated;
grant select on public.sb_lesson_progress_records to authenticated;
grant select on public.sb_practice_assignments to authenticated;
grant select on public.sb_project_exports to authenticated;
grant select on public.sb_student_lesson_reflections to authenticated;
grant all on public.sb_student_created_problems to service_role;
grant all on public.sb_peer_problem_attempts to service_role;
grant all on public.sb_lesson_progress_records to service_role;
grant all on public.sb_practice_assignments to service_role;
grant all on public.sb_project_exports to service_role;
grant all on public.sb_student_lesson_reflections to service_role;
revoke all on public.sb_student_created_problems from anon;
revoke all on public.sb_peer_problem_attempts from anon;
revoke all on public.sb_lesson_progress_records from anon;
revoke all on public.sb_practice_assignments from anon;
revoke all on public.sb_project_exports from anon;
revoke all on public.sb_student_lesson_reflections from anon;

-- Keep updated_at consistent with the existing schema convention.
do $$
declare t text;
begin
  foreach t in array array[
    'sb_student_created_problems','sb_peer_problem_attempts',
    'sb_lesson_progress_records','sb_practice_assignments',
    'sb_student_lesson_reflections'
  ] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format(
      'create trigger %I_touch before update on public.%I for each row execute function public.sb_touch_updated_at()',
      t, t);
  end loop;
end $$;

commit;
