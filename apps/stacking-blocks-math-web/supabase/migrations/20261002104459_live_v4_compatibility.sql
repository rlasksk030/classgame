-- Standalone expansion for the audited live student-api v4 schema (2026-10-02).
-- Also safe after the full fresh-install chain. NOT applied remotely.
-- Apply ONLY this file to that live database after the read-only fingerprint
-- checks in qa/predeploy. Do not replay pending historical migrations.
-- One transaction; no historical student/attempt/project/PIN/session deletion.
-- DELETE statements below belong to the explicit teacher reset RPC and do not
-- execute during migration. No migration-history repair is performed here.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
do $$ begin
 if not exists(select 1 from pg_trigger where tgrelid='public.sb_student_progress'::regclass
   and tgname='sb_student_progress_touch' and tgenabled='O') then
   raise exception 'PREFLIGHT_PROGRESS_TRIGGER';
 end if;
end $$;
alter table public.sb_lesson_settings
 add column if not exists allow_similar boolean not null default true,
 add column if not exists allow_retry boolean not null default true;
alter table public.sb_student_progress add column if not exists guided_completed boolean not null default false;
alter table public.sb_shared_challenges
 add column if not exists hint_type text not null default 'heightMap',
 add column if not exists source text not null default 'student';
alter table public.sb_shared_challenges alter column author_id drop not null;
-- XP로 해금한 외형을 학생 작품에 적용한다. 좌표/채점 데이터와 분리한다.
alter table public.sb_student_rewards
  add column if not exists equipped_material text not null default 'wood'
    check (equipped_material in ('wood','pastel','brick','tile')),
  add column if not exists intro_theme text not null default 'blueprint'
    check (intro_theme in ('blueprint','museum','sky'));

alter table public.sb_projects
  add column if not exists block_appearance jsonb not null default '{}'::jsonb,
  add column if not exists intro_theme text not null default 'blueprint'
    check (intro_theme in ('blueprint','museum','sky'));

-- 신규 건축물의 기본 작업판은 10×10이다. 기존 행의 좌표와 메타데이터는 그대로 둔다.
alter table public.sb_projects alter column grid_width set default 10;
alter table public.sb_projects alter column grid_depth set default 10;

-- Edge Function(service_role)만 호출한다. XP 임계값은 shared/rewards.ts와 동일하게 유지한다.
create or replace function public.sb_set_reward_loadout(
  p_student uuid,
  p_material text,
  p_theme text
) returns table(equipped_material text, intro_theme text)
language plpgsql security definer set search_path=public as $$
declare
  xp integer;
begin
  if not exists (select 1 from public.sb_students where id=p_student and status='active') then
    raise exception 'FORBIDDEN_STUDENT';
  end if;
  xp := coalesce((select total_xp from public.sb_student_rewards where student_id=p_student),0);
  if p_material not in ('wood','pastel','brick','tile') then raise exception 'INVALID_MATERIAL'; end if;
  if p_theme not in ('blueprint','museum','sky') then raise exception 'INVALID_THEME'; end if;
  if (p_material='pastel' and xp<50) or (p_material='brick' and xp<150) or (p_material='tile' and xp<300)
     or (p_theme='museum' and xp<250) or (p_theme='sky' and xp<450) then
    raise exception 'REWARD_LOCKED';
  end if;
  insert into public.sb_student_rewards(student_id,equipped_material,intro_theme)
    values(p_student,p_material,p_theme)
    on conflict(student_id) do update set equipped_material=excluded.equipped_material,intro_theme=excluded.intro_theme,updated_at=now();
  return query select r.equipped_material,r.intro_theme from public.sb_student_rewards r where r.student_id=p_student;
end; $$;
revoke all on function public.sb_set_reward_loadout(uuid,text,text) from public, anon, authenticated;
grant execute on function public.sb_set_reward_loadout(uuid,text,text) to service_role;

do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.sb_shared_challenges'::regclass and conname='sb_challenge_source') then
 alter table public.sb_shared_challenges add constraint sb_challenge_source CHECK ((((source = 'student'::text) AND (author_id IS NOT NULL)) OR ((source = 'system'::text) AND (author_id IS NULL))));
 end if;
end $$;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.sb_shared_challenges'::regclass and conname='sb_shared_challenges_challenge_type_check') then
 alter table public.sb_shared_challenges add constraint sb_shared_challenges_challenge_type_check CHECK ((challenge_type = ANY (ARRAY['views'::text, 'top'::text, 'heightMap'::text, 'layers'::text])));
 end if;
end $$;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.sb_shared_challenges'::regclass and conname='sb_shared_challenges_hint_type_check') then
 alter table public.sb_shared_challenges add constraint sb_shared_challenges_hint_type_check CHECK ((hint_type = ANY (ARRAY['views'::text, 'top'::text, 'heightMap'::text, 'layers'::text])));
 end if;
end $$;
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
  add column if not exists project_id uuid;
alter table public.sb_projects alter column project_id set default gen_random_uuid();
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

-- The existing touch trigger requires this field on assignments too.
alter table public.sb_practice_assignments add column if not exists updated_at timestamptz not null default now();

-- All new tables are RLS protected. Students never receive direct table grants;
-- the Edge Function uses service_role after validating the student session.
alter table public.sb_student_created_problems enable row level security;
alter table public.sb_peer_problem_attempts enable row level security;
alter table public.sb_lesson_progress_records enable row level security;
alter table public.sb_practice_assignments enable row level security;
alter table public.sb_project_exports enable row level security;
alter table public.sb_student_lesson_reflections enable row level security;

do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='sb_student_created_problems' and policyname='sb_student_created_problems_teacher') then
  create policy sb_student_created_problems_teacher on public.sb_student_created_problems
  for select to authenticated using (public.sb_owns_class(class_id));
 end if;
end $$;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='sb_student_created_problems' and policyname='sb_student_created_problems_teacher_update') then
  create policy sb_student_created_problems_teacher_update on public.sb_student_created_problems
  for update to authenticated using (public.sb_owns_class(class_id)) with check (public.sb_owns_class(class_id));
 end if;
end $$;

do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='sb_peer_problem_attempts' and policyname='sb_peer_problem_attempts_teacher') then
  create policy sb_peer_problem_attempts_teacher on public.sb_peer_problem_attempts
  for select to authenticated using (public.sb_owns_class(class_id));
 end if;
end $$;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='sb_lesson_progress_records' and policyname='sb_lesson_progress_records_teacher') then
  create policy sb_lesson_progress_records_teacher on public.sb_lesson_progress_records
  for select to authenticated using (public.sb_owns_class(class_id));
 end if;
end $$;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='sb_practice_assignments' and policyname='sb_practice_assignments_teacher') then
  create policy sb_practice_assignments_teacher on public.sb_practice_assignments
  for select to authenticated using (public.sb_owns_class(class_id));
 end if;
end $$;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='sb_project_exports' and policyname='sb_project_exports_teacher') then
  create policy sb_project_exports_teacher on public.sb_project_exports
  for select to authenticated using (public.sb_owns_class(class_id));
 end if;
end $$;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='sb_student_lesson_reflections' and policyname='sb_student_lesson_reflections_teacher') then
  create policy sb_student_lesson_reflections_teacher on public.sb_student_lesson_reflections
  for select to authenticated using (public.sb_owns_class(class_id));
 end if;
end $$;

revoke all on public.sb_student_created_problems,public.sb_peer_problem_attempts,public.sb_lesson_progress_records,public.sb_practice_assignments,public.sb_project_exports,public.sb_student_lesson_reflections from authenticated;

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
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and tgname=t||'_touch' and not tgisinternal) then
    execute format(
      'create trigger %I_touch before update on public.%I for each row execute function public.sb_touch_updated_at()',
      t, t);
    end if;
  end loop;
end $$;


-- Required completion matches the live /solve route: active, class-visible
-- order_index = 2 problems. Concept exploration and optional practice (including
-- other students' generated sets) must never enlarge the required denominator.
-- Replaces the RPC without rewriting existing progress, attempts, or rewards.
-- Historical progress is derived from existing attempts by the read API; future
-- submissions persist the corrected value through this transaction.
create or replace function public.sb_record_attempt(
  p_student uuid, p_problem uuid, p_expected integer, p_next jsonb, p_blocks jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  student_row public.sb_students%rowtype;
  problem_row public.sb_problems%rowtype;
  previous public.sb_problem_attempts%rowtype;
  total integer;
  done integer;
  star_count integer;
begin
  select * into strict student_row from public.sb_students where id=p_student for update;
  if student_row.status <> 'active' then raise exception 'STUDENT_DISABLED'; end if;
  select * into strict problem_row from public.sb_problems where id=p_problem and active
    and (class_id is null or class_id=student_row.class_id);
  if coalesce((select locked from public.sb_lesson_settings where class_id=student_row.class_id and lesson=problem_row.lesson),problem_row.lesson<>1)
    then raise exception 'LESSON_LOCKED'; end if;
  select * into previous from public.sb_problem_attempts where student_id=p_student and problem_id=p_problem;
  if coalesce(previous.attempt_count,0)<>p_expected then raise exception 'ATTEMPT_CONFLICT'; end if;
  if previous.completed then return; end if;
  insert into public.sb_problem_attempts(student_id,problem_id,lesson,wrong_count,hint_shown,answer_revealed,completed,attempt_count,stars,xp_earned,completed_at)
  values(p_student,p_problem,problem_row.lesson,(p_next->>'wrongCount')::integer,(p_next->>'hintShown')::boolean,(p_next->>'answerRevealed')::boolean,
    (p_next->>'completed')::boolean,p_expected+1,(p_next->>'stars')::integer,(p_next->>'xp')::integer,
    case when (p_next->>'completed')::boolean then now() else null end)
  on conflict(student_id,problem_id) do update set
    wrong_count=excluded.wrong_count,hint_shown=excluded.hint_shown,answer_revealed=excluded.answer_revealed,completed=excluded.completed,
    attempt_count=excluded.attempt_count,stars=excluded.stars,xp_earned=excluded.xp_earned,completed_at=excluded.completed_at,updated_at=now();
  if p_blocks is not null then
    insert into public.sb_block_snapshots(student_id,problem_id,lesson,blocks,grid_width,grid_depth,max_height)
    values(p_student,p_problem,problem_row.lesson,p_blocks,problem_row.grid_width,problem_row.grid_depth,problem_row.max_height)
    on conflict(student_id,problem_id) do update set blocks=excluded.blocks,updated_at=now();
  end if;

  -- Stars still include completed work from every stage; required-only counting
  -- must not remove rewards already earned through optional practice.
  select coalesce(sum(a.stars),0) into star_count from public.sb_problem_attempts a
    join public.sb_problems p on p.id=a.problem_id where a.student_id=p_student
      and p.lesson=problem_row.lesson and p.active and (p.class_id is null or p.class_id=student_row.class_id);

  if problem_row.lesson between 1 and 8 or problem_row.lesson=12 then
    select count(*), count(*) filter(where a.completed) into total,done
      from public.sb_problems p
      left join public.sb_problem_attempts a on a.problem_id=p.id and a.student_id=p_student
      where p.lesson=problem_row.lesson and p.active and p.order_index=2
        and (p.class_id is null or p.class_id=student_row.class_id);
    insert into public.sb_student_progress(student_id,lesson,completed,completed_at,stars,last_problem_id)
    values(p_student,problem_row.lesson,total>0 and done=total,case when total>0 and done=total then now() else null end,star_count,p_problem)
    on conflict(student_id,lesson) do update set
      completed=excluded.completed,
      completed_at=case when excluded.completed then coalesce(sb_student_progress.completed_at,excluded.completed_at) else null end,
      stars=excluded.stars,last_problem_id=excluded.last_problem_id,updated_at=now();
  else
    -- Lessons 9–11 complete through their challenge/project RPCs. An ordinary
    -- problem attempt can record work here but cannot complete or undo them.
    insert into public.sb_student_progress(student_id,lesson,stars,last_problem_id)
    values(p_student,problem_row.lesson,star_count,p_problem)
    on conflict(student_id,lesson) do update set
      stars=greatest(sb_student_progress.stars,excluded.stars),
      last_problem_id=excluded.last_problem_id,updated_at=now();
  end if;
  insert into public.sb_student_rewards(student_id,total_xp,total_stars)
  select p_student,coalesce(sum(xp_earned),0),coalesce(sum(stars),0) from public.sb_problem_attempts where student_id=p_student
  on conflict(student_id) do update set total_xp=excluded.total_xp,total_stars=excluded.total_stars,updated_at=now();
end;
$$;
revoke all on function public.sb_record_attempt(uuid,uuid,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.sb_record_attempt(uuid,uuid,integer,jsonb,jsonb) to service_role;

create or replace function public.sb_save_building(p_student uuid,p_class uuid,p_version integer,p_data jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare
  current_version integer; next_version integer;
  requested_width integer; requested_depth integer; requested_height integer;
  material text; theme text; xp integer; prior public.sb_projects;
begin
  perform 1 from public.sb_students where id=p_student and class_id=p_class and status='active' for update;
  if not found then raise exception 'FORBIDDEN_STUDENT'; end if;
  select * into prior from public.sb_projects where student_id=p_student;
  current_version := prior.version;
  if coalesce(current_version,0)<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  next_version:=coalesce(current_version,0)+1;
  requested_width := case when coalesce(p_data->>'grid_width','') ~ '^[0-9]+$' then (p_data->>'grid_width')::integer else coalesce(prior.grid_width,5) end;
  requested_depth := case when coalesce(p_data->>'grid_depth','') ~ '^[0-9]+$' then (p_data->>'grid_depth')::integer else coalesce(prior.grid_depth,5) end;
  requested_height := case when coalesce(p_data->>'max_height','') ~ '^[0-9]+$' then (p_data->>'max_height')::integer else 3 end;
  requested_width := greatest(4, least(10, requested_width)); requested_depth := greatest(4, least(10, requested_depth)); requested_height := 3;
  xp := coalesce((select total_xp from public.sb_student_rewards where student_id=p_student),0);
  material := coalesce((select equipped_material from public.sb_student_rewards where student_id=p_student),'wood');
  theme := coalesce(p_data->>'intro_theme', prior.intro_theme, coalesce((select intro_theme from public.sb_student_rewards where student_id=p_student),'blueprint'));
  if theme not in ('blueprint','museum','sky') then theme := 'blueprint'; end if;
  if p_data ? 'intro_theme' and ((theme='museum' and xp<250) or (theme='sky' and xp<450)) then theme := 'blueprint'; end if;
  insert into public.sb_projects(student_id,class_id,building_name,reason,description,layer_notes,blocks,block_appearance,intro_theme,grid_width,grid_depth,max_height,submitted,version)
  values(p_student,p_class,p_data->>'building_name',p_data->>'reason',p_data->>'description',p_data->'layer_notes',p_data->'blocks',coalesce(p_data->'block_appearance',prior.block_appearance,'{}'::jsonb),theme,requested_width,requested_depth,requested_height,(p_data->>'submitted')::boolean,next_version)
  on conflict(student_id) do update set building_name=excluded.building_name,reason=excluded.reason,description=excluded.description,layer_notes=excluded.layer_notes,blocks=excluded.blocks,block_appearance=excluded.block_appearance,intro_theme=excluded.intro_theme,grid_width=excluded.grid_width,grid_depth=excluded.grid_depth,max_height=excluded.max_height,submitted=excluded.submitted,version=excluded.version;
  -- Persist the actual activity location, including a draft that is not complete.
  insert into public.sb_student_progress(student_id,lesson)
    values(p_student,case when p_data->>'progress_lesson'='11' then 11 else 10 end)
    on conflict(student_id,lesson) do update set updated_at=now();
  if (p_data->>'submitted')::boolean then
    insert into public.sb_student_progress(student_id,lesson,completed,completed_at,stars) values(p_student,10,true,now(),1),(p_student,11,true,now(),1)
    on conflict(student_id,lesson) do update set completed=true,completed_at=now(),stars=1;
  end if;
  return next_version;
end; $$;
revoke all on function public.sb_save_building(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.sb_save_building(uuid,uuid,integer,jsonb) to service_role;

create or replace function public.sb_submit_challenge_v2(p_student uuid,p_challenge uuid,p_previous integer,p_state jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare prior public.sb_challenge_solves; awarded boolean; result public.sb_challenge_solves;
begin
 perform 1 from public.sb_students s join public.sb_shared_challenges c on c.class_id=s.class_id
 where s.id=p_student and c.id=p_challenge and s.status='active' and c.author_id is distinct from p_student for update of s;
 if not found then raise exception 'FORBIDDEN_CLASS_OR_AUTHOR'; end if;
 if not exists(select 1 from public.sb_lesson_settings l join public.sb_students s on s.class_id=l.class_id where s.id=p_student and l.lesson=9 and not l.locked) then raise exception 'LESSON_LOCKED'; end if;
 select * into prior from public.sb_challenge_solves where student_id=p_student and challenge_id=p_challenge;
 if prior.correct then return jsonb_build_object('state',to_jsonb(prior),'awarded',false); end if;
 if coalesce(prior.wrong_count,0)<>p_previous or coalesce(prior.used_hint,false)<>coalesce((p_state->>'expectedHintShown')::boolean,false) then raise exception 'VERSION_CONFLICT'; end if;
 awarded:=coalesce((p_state->>'completed')::boolean,false);
 insert into public.sb_challenge_solves(challenge_id,student_id,correct,used_hint,wrong_count,answer_revealed,xp,score)
 values(p_challenge,p_student,awarded,(p_state->>'hintShown')::boolean,(p_state->>'wrongCount')::integer,(p_state->>'answerRevealed')::boolean,0,case when not awarded or (p_state->>'answerRevealed')::boolean then 0 when (p_state->>'hintShown')::boolean then 1 else 2 end)
 on conflict(challenge_id,student_id) do update set correct=excluded.correct,used_hint=excluded.used_hint,wrong_count=excluded.wrong_count,answer_revealed=excluded.answer_revealed,xp=0,score=excluded.score,solved_at=now()
 returning * into result;
 insert into public.sb_student_progress(student_id,lesson,completed,completed_at,stars) values(p_student,9,awarded,case when awarded then now() else null end,case when awarded then 1 else 0 end)
 on conflict(student_id,lesson) do update set completed=sb_student_progress.completed or excluded.completed,
 completed_at=coalesce(sb_student_progress.completed_at,excluded.completed_at),
 stars=greatest(sb_student_progress.stars,excluded.stars),updated_at=now();
 return jsonb_build_object('state',to_jsonb(result),'awarded',awarded);
end; $$;
revoke all on function public.sb_submit_challenge_v2(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.sb_submit_challenge_v2(uuid,uuid,integer,jsonb) to service_role;

-- Creating a peer question is participation, not successful-solving completion.
create or replace function public.sb_track_challenge_author()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.author_id is not null then
   insert into public.sb_student_progress(student_id,lesson)
   select s.id,9 from public.sb_students s where s.id=new.author_id and s.class_id=new.class_id
   on conflict(student_id,lesson) do update set updated_at=now();
 end if;
 return new;
end; $$;
revoke all on function public.sb_track_challenge_author() from public,anon,authenticated;
do $$ begin
 if not exists(select 1 from pg_trigger where tgrelid='public.sb_shared_challenges'::regclass and tgname='sb_track_challenge_author') then
 create trigger sb_track_challenge_author after insert on public.sb_shared_challenges
 for each row execute function public.sb_track_challenge_author();
 end if;
end $$;

-- Promote only completion fields from saved evidence, keeping last activity,
-- all attempts, XP, stars, snapshots, projects, and practice seeds unchanged.
-- The named timestamp trigger is suspended only under this transaction's table
-- lock; failure rolls back both the data and trigger state. No RLS changes.
lock table public.sb_student_progress in access exclusive mode;
alter table public.sb_student_progress disable trigger sb_student_progress_touch;
with required as (
 select s.id student_id,p.lesson,count(*) total,count(*) filter(where a.completed) done,
        max(coalesce(a.completed_at,a.updated_at)) filter(where a.completed) completed_at
 from public.sb_students s join public.sb_problems p
   on (p.class_id is null or p.class_id=s.class_id) and p.active and p.order_index=2
   and (p.lesson between 1 and 8 or p.lesson=12)
 left join public.sb_problem_attempts a on a.student_id=s.id and a.problem_id=p.id
 group by s.id,p.lesson
), candidates as (
 select student_id,lesson from required where total>0 and total=done
)
insert into public.sb_student_progress(student_id,lesson,completed,completed_at,updated_at,stars)
select c.student_id,c.lesson,coalesce(r.total>0 and r.total=r.done,false),
       case when r.total>0 and r.total=r.done then r.completed_at else null end,
       coalesce(old.updated_at,r.completed_at,now()),
       coalesce(old.stars,(select coalesce(sum(a.stars),0) from public.sb_problem_attempts a where a.student_id=c.student_id and a.lesson=c.lesson))
from candidates c left join required r using(student_id,lesson)
left join public.sb_student_progress old using(student_id,lesson)
on conflict(student_id,lesson) do update set completed=excluded.completed,
 completed_at=case when excluded.completed then coalesce(sb_student_progress.completed_at,excluded.completed_at) else null end
where sb_student_progress.completed is distinct from excluded.completed
   or (excluded.completed and sb_student_progress.completed_at is null)
   or (not excluded.completed and sb_student_progress.completed_at is not null);

-- Special activities retain an earned completion until an explicit reset.
-- A draft/incorrect solve can record participation but never grant completion.
with activity_evidence as (
 select a.student_id,9 lesson,bool_or(a.correct) completed,
        max(a.solved_at) filter(where a.correct) completed_at,max(a.solved_at) updated_at
 from public.sb_challenge_solves a
 join public.sb_shared_challenges c on c.id=a.challenge_id
 join public.sb_students s on s.id=a.student_id and s.class_id=c.class_id
 where c.author_id is distinct from s.id group by a.student_id
 union all
 select c.author_id,9,false,null::timestamptz,max(c.created_at)
 from public.sb_shared_challenges c join public.sb_students s on s.id=c.author_id and s.class_id=c.class_id
 group by c.author_id
 union all
 select p.student_id,l.lesson,p.submitted,
        case when p.submitted then p.updated_at else null end,p.updated_at
 from public.sb_projects p join public.sb_students s on s.id=p.student_id and s.class_id=p.class_id
 cross join (values(10),(11)) l(lesson) where l.lesson=10 or p.submitted
), activity as (
 select student_id,lesson,bool_or(completed) completed,max(completed_at) completed_at,max(updated_at) updated_at
 from activity_evidence group by student_id,lesson
)
insert into public.sb_student_progress(student_id,lesson,completed,completed_at,updated_at,stars)
select student_id,lesson,completed,completed_at,updated_at,case when completed then 1 else 0 end from activity
on conflict(student_id,lesson) do update set completed=true,
 completed_at=coalesce(sb_student_progress.completed_at,excluded.completed_at)
where excluded.completed and not sb_student_progress.completed;
alter table public.sb_student_progress enable trigger sb_student_progress_touch;

-- One service-role RPC, one database transaction. The caller supplies the
-- authenticated teacher identity, never an arbitrary list of student IDs.
create or replace function public.sb_reset_class_progress(p_class uuid,p_teacher uuid,p_lesson integer default null)
returns integer language plpgsql security invoker set search_path='' as $$
declare ids uuid[]; lessons integer[];
begin
 if p_lesson is not null and (p_lesson<1 or p_lesson>12) then raise exception 'BAD_LESSON'; end if;
 perform 1 from public.sb_classes where id=p_class and teacher_id=p_teacher for update;
 if not found then raise exception 'FORBIDDEN_CLASS'; end if;
 -- Same student-row locks as submission RPCs; deterministic order avoids
 -- concurrent class resets taking the locks in opposite orders.
 select coalesce(array_agg(id),'{}'::uuid[]) into ids from
   (select id from public.sb_students where class_id=p_class order by id for update) locked;
 if cardinality(ids)=0 then return 0; end if;
 lessons:=case when p_lesson is null then null when p_lesson in (10,11) then array[10,11] else array[p_lesson] end;
 delete from public.sb_problem_attempts where student_id=any(ids) and (lessons is null or lesson=any(lessons));
 delete from public.sb_block_snapshots where student_id=any(ids) and (lessons is null or lesson=any(lessons));
 delete from public.sb_student_progress where student_id=any(ids) and (lessons is null or lesson=any(lessons));
 delete from public.sb_lesson_progress_records where student_id=any(ids) and (lessons is null or lesson=any(lessons));
 delete from public.sb_practice_assignments where student_id=any(ids) and (lessons is null or lesson=any(lessons));
 delete from public.sb_student_lesson_reflections where student_id=any(ids) and (lessons is null or lesson=any(lessons));
 if p_lesson is null or p_lesson=9 then
   delete from public.sb_challenge_solves where student_id=any(ids);
   delete from public.sb_peer_problem_attempts where student_id=any(ids);
 end if;
 if p_lesson is null or p_lesson in (10,11) then
   delete from public.sb_project_exports where student_id=any(ids);
   delete from public.sb_projects where student_id=any(ids);
 end if;
 if p_lesson is null or p_lesson=12 then delete from public.sb_self_evaluations where student_id=any(ids); end if;
 -- Authored questions remain available to classmates; their attempts and
 -- question definitions are not the reset student's personal progress.
 insert into public.sb_student_rewards(student_id,total_xp,total_stars,badges,streak)
 select s.id,coalesce(sum(a.xp_earned),0),coalesce(sum(a.stars),0),'[]'::jsonb,0
 from public.sb_students s left join public.sb_problem_attempts a on a.student_id=s.id
 where s.id=any(ids) group by s.id
 on conflict(student_id) do update set total_xp=excluded.total_xp,total_stars=excluded.total_stars,badges=excluded.badges,streak=excluded.streak;
 return cardinality(ids);
end; $$;
revoke all on function public.sb_reset_class_progress(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.sb_reset_class_progress(uuid,uuid,integer) to service_role;

-- Fail closed on conflicting partial expansions; the transaction rolls back.
do $$ begin
 if exists(select 1 from (values
 ('sb_lesson_progress_records','installation_id','text'),
 ('sb_lesson_progress_records','class_id','uuid'),
 ('sb_lesson_progress_records','student_id','uuid'),
 ('sb_lesson_progress_records','curriculum_version','text'),
 ('sb_lesson_progress_records','lesson','int2'),
 ('sb_lesson_progress_records','stage','text'),
 ('sb_lesson_progress_records','set_id','text'),
 ('sb_lesson_progress_records','problem_id','text'),
 ('sb_lesson_progress_records','problem_version','int4'),
 ('sb_lesson_progress_records','question_index','int4'),
 ('sb_lesson_progress_records','answer','jsonb'),
 ('sb_lesson_progress_records','first_attempt_result','text'),
 ('sb_lesson_progress_records','attempt_count','int4'),
 ('sb_lesson_progress_records','hint_level','int2'),
 ('sb_lesson_progress_records','final_result','text'),
 ('sb_lesson_progress_records','remediation_status','text'),
 ('sb_lesson_progress_records','completed_at','timestamptz'),
 ('sb_lesson_progress_records','self_evaluation','jsonb'),
 ('sb_lesson_progress_records','created_at','timestamptz'),
 ('sb_lesson_progress_records','updated_at','timestamptz'),
 ('sb_lesson_settings','allow_similar','bool'),
 ('sb_lesson_settings','allow_retry','bool'),
 ('sb_peer_problem_attempts','id','uuid'),
 ('sb_peer_problem_attempts','installation_id','text'),
 ('sb_peer_problem_attempts','class_id','uuid'),
 ('sb_peer_problem_attempts','problem_id','uuid'),
 ('sb_peer_problem_attempts','problem_version','int4'),
 ('sb_peer_problem_attempts','student_id','uuid'),
 ('sb_peer_problem_attempts','used_hint','bool'),
 ('sb_peer_problem_attempts','submitted_answer_json','jsonb'),
 ('sb_peer_problem_attempts','is_correct','bool'),
 ('sb_peer_problem_attempts','score_awarded','int2'),
 ('sb_peer_problem_attempts','completed_at','timestamptz'),
 ('sb_peer_problem_attempts','idempotency_key','text'),
 ('sb_peer_problem_attempts','created_at','timestamptz'),
 ('sb_peer_problem_attempts','updated_at','timestamptz'),
 ('sb_practice_assignments','assignment_id','uuid'),
 ('sb_practice_assignments','installation_id','text'),
 ('sb_practice_assignments','class_id','uuid'),
 ('sb_practice_assignments','student_id','uuid'),
 ('sb_practice_assignments','lesson','int2'),
 ('sb_practice_assignments','curriculum_version','text'),
 ('sb_practice_assignments','set_id','text'),
 ('sb_practice_assignments','seed','int4'),
 ('sb_practice_assignments','problem_ids','jsonb'),
 ('sb_practice_assignments','target_total','int2'),
 ('sb_practice_assignments','active','bool'),
 ('sb_practice_assignments','created_at','timestamptz'),
 ('sb_practice_assignments','deactivated_at','timestamptz'),
 ('sb_project_exports','id','uuid'),
 ('sb_project_exports','installation_id','text'),
 ('sb_project_exports','class_id','uuid'),
 ('sb_project_exports','student_id','uuid'),
 ('sb_project_exports','project_id','uuid'),
 ('sb_project_exports','project_version','int4'),
 ('sb_project_exports','export_type','text'),
 ('sb_project_exports','snapshot_json','jsonb'),
 ('sb_project_exports','created_at','timestamptz'),
 ('sb_projects','block_appearance','jsonb'),
 ('sb_projects','intro_theme','text'),
 ('sb_projects','project_id','uuid'),
 ('sb_shared_challenges','hint_type','text'),
 ('sb_shared_challenges','source','text'),
 ('sb_student_created_problems','problem_id','uuid'),
 ('sb_student_created_problems','version','int4'),
 ('sb_student_created_problems','installation_id','text'),
 ('sb_student_created_problems','class_id','uuid'),
 ('sb_student_created_problems','author_student_id','uuid'),
 ('sb_student_created_problems','title','text'),
 ('sb_student_created_problems','public_problem_json','jsonb'),
 ('sb_student_created_problems','hidden_validation_json','jsonb'),
 ('sb_student_created_problems','hint_type','text'),
 ('sb_student_created_problems','status','text'),
 ('sb_student_created_problems','published_at','timestamptz'),
 ('sb_student_created_problems','hidden_at','timestamptz'),
 ('sb_student_created_problems','created_at','timestamptz'),
 ('sb_student_created_problems','updated_at','timestamptz'),
 ('sb_student_lesson_reflections','installation_id','text'),
 ('sb_student_lesson_reflections','class_id','uuid'),
 ('sb_student_lesson_reflections','student_id','uuid'),
 ('sb_student_lesson_reflections','lesson','int2'),
 ('sb_student_lesson_reflections','curriculum_version','text'),
 ('sb_student_lesson_reflections','confidence','int2'),
 ('sb_student_lesson_reflections','favorite_concept','text'),
 ('sb_student_lesson_reflections','self_praise','text'),
 ('sb_student_lesson_reflections','updated_at','timestamptz'),
 ('sb_student_progress','guided_completed','bool'),
 ('sb_student_rewards','equipped_material','text'),
 ('sb_student_rewards','intro_theme','text')) expected(tbl,col,typ) left join information_schema.columns c on c.table_schema='public' and c.table_name=expected.tbl and c.column_name=expected.col where c.udt_name is distinct from expected.typ) then raise exception 'PREFLIGHT_COLUMN_CONFLICT'; end if;
end $$;
commit;
