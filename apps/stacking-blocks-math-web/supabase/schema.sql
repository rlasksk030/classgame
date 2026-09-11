-- ===========================================================================
-- 3D 쌓기나무 「공간과 입체」 학습 앱 - 데이터베이스 스키마
--
-- Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행하세요.
-- 여러 번 실행해도 안전합니다.
--
-- 표 이름에 sb_ (stacking blocks) 접두사를 붙여 같은 프로젝트의
-- 다른 앱 표와 절대 충돌하지 않게 했습니다 (명세 7).
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. 학급 · 교사
-- ---------------------------------------------------------------------------

create table if not exists public.sb_classes (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  -- 학생 접속 링크에 들어가는 값. ?class=XXXX
  class_code  text not null unique,
  school_year int not null default extract(year from now()),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists sb_classes_teacher_idx on public.sb_classes (teacher_id);

create table if not exists public.sb_teacher_settings (
  teacher_id   uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. 학생
--    학생은 Supabase Auth 회원이 아니다. 이름 + 4자리 PIN 으로만 들어온다.
--    동명이인이 있어도 내부 student_id(uuid)는 항상 따로 존재한다 (명세 5).
-- ---------------------------------------------------------------------------

create table if not exists public.sb_students (
  id              uuid primary key default gen_random_uuid(),
  class_id        uuid not null references public.sb_classes (id) on delete cascade,
  name            text not null,
  -- 같은 반에서 이름이 겹칠 때 구분하는 번호. 화면에는 "홍길동(3번)" 처럼 나온다.
  student_no      int,
  -- PIN 원문은 여기에 없다. 대조용 해시만 둔다 (AI 면담실 방식).
  pin_hash        text not null,
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  status          text not null default 'active' check (status in ('active', 'disabled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (class_id, name, student_no)
);

create index if not exists sb_students_class_idx on public.sb_students (class_id);

-- 교사가 "전체 PIN 보기 / 복사" 를 할 수 있어야 하므로 원문을 따로 보관한다.
-- 이 표는 오직 담당 교사만 읽을 수 있고, 학생 API 는 절대 건드리지 않는다 (명세 5).
create table if not exists public.sb_student_pin_vault (
  student_id  uuid primary key references public.sb_students (id) on delete cascade,
  class_id    uuid not null references public.sb_classes (id) on delete cascade,
  pin_plain   text not null,
  issued_at   timestamptz not null default now()
);

-- 발급한 학생 세션. 토큰 자체가 아니라 해시를 저장해 유출에 대비한다.
create table if not exists public.sb_student_sessions (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.sb_students (id) on delete cascade,
  class_id     uuid not null references public.sb_classes (id) on delete cascade,
  token_hash   text not null unique,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked      boolean not null default false
);

create index if not exists sb_sessions_student_idx on public.sb_student_sessions (student_id);
create index if not exists sb_sessions_expiry_idx  on public.sb_student_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- 3. 차시 설정 (명세 6 - 개별/전체 잠금)
-- ---------------------------------------------------------------------------

create table if not exists public.sb_lesson_settings (
  class_id   uuid not null references public.sb_classes (id) on delete cascade,
  lesson     smallint not null check (lesson between 1 and 12),
  locked     boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (class_id, lesson)
);

-- ---------------------------------------------------------------------------
-- 4. 문제
--    answer 컬럼에는 정답 원본이 들어간다. 학생은 이 표를 직접 읽을 수 없고,
--    Edge Function 이 정답을 뺀 형태로만 내려보낸다 (명세 8).
-- ---------------------------------------------------------------------------

create table if not exists public.sb_problems (
  id            uuid primary key default gen_random_uuid(),
  -- null 이면 모든 학급이 함께 쓰는 기본 문제.
  class_id      uuid references public.sb_classes (id) on delete cascade,
  created_by    uuid references auth.users (id) on delete set null,
  -- 기본 문제를 갱신할 때 기준이 되는 코드 (예: L3-01).
  code          text,
  lesson        smallint not null check (lesson between 1 and 12),
  order_index   int not null default 0,

  problem_type  text not null,
  title         text not null,
  prompt        text not null default '',

  grid_width    smallint not null default 4 check (grid_width between 1 and 8),
  grid_depth    smallint not null default 4 check (grid_depth between 1 and 8),
  max_height    smallint not null default 4 check (max_height between 1 and 8),

  -- 문제에서 보여 주는 모양 / 학생 작업판 시작 블록
  given_blocks  jsonb not null default '[]'::jsonb,
  start_blocks  jsonb not null default '[]'::jsonb,
  -- 보여 줄 조건(투영, 숫자 지도, 층별 그림 등)
  given         jsonb not null default '{}'::jsonb,
  choices       jsonb not null default '[]'::jsonb,

  answer        jsonb not null,
  grading_mode  text not null default 'exact' check (grading_mode in ('exact', 'constraint')),

  hint          text not null default '',
  explanation   text not null default '',
  difficulty    smallint not null default 2 check (difficulty between 1 and 3),
  xp            int not null default 30 check (xp >= 0),
  active        boolean not null default true,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (class_id, code)
);

create index if not exists sb_problems_lesson_idx on public.sb_problems (lesson, order_index);
create index if not exists sb_problems_class_idx  on public.sb_problems (class_id);

-- ---------------------------------------------------------------------------
-- 5. 학생 진도 · 시도 기록 (명세 6)
-- ---------------------------------------------------------------------------

create table if not exists public.sb_student_progress (
  student_id        uuid not null references public.sb_students (id) on delete cascade,
  lesson            smallint not null check (lesson between 1 and 12),
  completed         boolean not null default false,
  completed_at      timestamptz,
  stars             int not null default 0,
  last_problem_id   uuid references public.sb_problems (id) on delete set null,
  updated_at        timestamptz not null default now(),
  primary key (student_id, lesson)
);

create table if not exists public.sb_problem_attempts (
  id              uuid primary key default gen_random_uuid(),
  student_id      uuid not null references public.sb_students (id) on delete cascade,
  problem_id      uuid not null references public.sb_problems (id) on delete cascade,
  lesson          smallint not null,
  -- 명세 17 의 상태 기계 값
  wrong_count     int not null default 0,
  hint_shown      boolean not null default false,
  answer_revealed boolean not null default false,
  completed       boolean not null default false,
  attempt_count   int not null default 0,
  stars           int not null default 0,
  xp_earned       int not null default 0,
  first_seen_at   timestamptz not null default now(),
  completed_at    timestamptz,
  updated_at      timestamptz not null default now(),
  unique (student_id, problem_id)
);

create index if not exists sb_attempts_student_idx on public.sb_problem_attempts (student_id, lesson);

-- 학생이 마지막으로 쌓았던 모양 (명세 6 - 교사가 3D 로 다시 볼 수 있어야 한다)
create table if not exists public.sb_block_snapshots (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.sb_students (id) on delete cascade,
  problem_id  uuid references public.sb_problems (id) on delete cascade,
  lesson      smallint not null,
  -- [{"x":0,"y":0,"z":0}, ...] 항상 같은 규칙으로 정렬해서 저장한다.
  blocks      jsonb not null default '[]'::jsonb,
  grid_width  smallint not null default 4,
  grid_depth  smallint not null default 4,
  max_height  smallint not null default 4,
  label       text,
  updated_at  timestamptz not null default now(),
  unique (student_id, problem_id)
);

create index if not exists sb_snapshots_student_idx on public.sb_block_snapshots (student_id, lesson);

-- 게임 보상 (명세 19). 학업 평가와는 분리된 값이다.
create table if not exists public.sb_student_rewards (
  student_id   uuid primary key references public.sb_students (id) on delete cascade,
  total_xp     int not null default 0,
  total_stars  int not null default 0,
  badges       jsonb not null default '[]'::jsonb,
  streak       int not null default 0,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. 9차시 놀이 - 친구에게 낸 문제 (명세 30)
-- ---------------------------------------------------------------------------

create table if not exists public.sb_shared_challenges (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references public.sb_classes (id) on delete cascade,
  author_id    uuid not null references public.sb_students (id) on delete cascade,
  -- 친구에게 알려 줄 짧은 코드
  share_code   text not null unique,
  challenge_type text not null default 'views',
  blocks       jsonb not null default '[]'::jsonb,
  grid_width   smallint not null default 4,
  grid_depth   smallint not null default 4,
  max_height   smallint not null default 4,
  solved_count int not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists public.sb_challenge_solves (
  challenge_id uuid not null references public.sb_shared_challenges (id) on delete cascade,
  student_id   uuid not null references public.sb_students (id) on delete cascade,
  correct      boolean not null default false,
  used_hint    boolean not null default false,
  solved_at    timestamptz not null default now(),
  primary key (challenge_id, student_id)
);

-- ---------------------------------------------------------------------------
-- 7. 10~11차시 프로젝트 - 나만의 건축물 (명세 31)
-- ---------------------------------------------------------------------------

create table if not exists public.sb_projects (
  student_id    uuid primary key references public.sb_students (id) on delete cascade,
  class_id      uuid not null references public.sb_classes (id) on delete cascade,
  building_name text not null default '',
  reason        text not null default '',
  description   text not null default '',
  layer_notes   jsonb not null default '[]'::jsonb,
  blocks        jsonb not null default '[]'::jsonb,
  grid_width    smallint not null default 5,
  grid_depth    smallint not null default 5,
  max_height    smallint not null default 5,
  -- 3D 화면 캡처 (data URL). 소개서 화면에 자동 배치한다.
  capture       text,
  submitted     boolean not null default false,
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 8. updated_at 자동 갱신
-- ---------------------------------------------------------------------------

create or replace function public.sb_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'sb_classes','sb_teacher_settings','sb_students','sb_lesson_settings','sb_problems',
    'sb_student_progress','sb_problem_attempts','sb_block_snapshots','sb_student_rewards','sb_projects'
  ] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format(
      'create trigger %I_touch before update on public.%I for each row execute function public.sb_touch_updated_at()',
      t, t);
  end loop;
end $$;

-- ===========================================================================
-- 9. Row Level Security (명세 8)
--
-- 설계 원칙
--   · 교사는 Supabase Auth 로그인 사용자다. 자기 학급 데이터만 다룬다.
--   · 학생은 Auth 회원이 아니다. anon 키로는 아무 표도 읽거나 쓸 수 없다.
--     학생 요청은 전부 Edge Function 을 지나며, 거기서만 service_role 을 쓴다.
--   · 그래서 sb_problems.answer(정답 원본)는 브라우저로 절대 새어 나가지 않는다.
-- ===========================================================================

alter table public.sb_classes            enable row level security;
alter table public.sb_teacher_settings   enable row level security;
alter table public.sb_students           enable row level security;
alter table public.sb_student_pin_vault  enable row level security;
alter table public.sb_student_sessions   enable row level security;
alter table public.sb_lesson_settings    enable row level security;
alter table public.sb_problems           enable row level security;
alter table public.sb_student_progress   enable row level security;
alter table public.sb_problem_attempts   enable row level security;
alter table public.sb_block_snapshots    enable row level security;
alter table public.sb_student_rewards    enable row level security;
alter table public.sb_shared_challenges  enable row level security;
alter table public.sb_challenge_solves   enable row level security;
alter table public.sb_projects           enable row level security;

-- 이 학급이 내 학급인가?
create or replace function public.sb_owns_class(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sb_classes c
    where c.id = target and c.teacher_id = auth.uid()
  );
$$;

-- 이 학생이 내 학급 학생인가?
create or replace function public.sb_owns_student(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sb_students s
    join public.sb_classes c on c.id = s.class_id
    where s.id = target and c.teacher_id = auth.uid()
  );
$$;

-- --- 교사 소유 데이터 ---
drop policy if exists sb_classes_owner on public.sb_classes;
create policy sb_classes_owner on public.sb_classes
  for all to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

drop policy if exists sb_teacher_settings_owner on public.sb_teacher_settings;
create policy sb_teacher_settings_owner on public.sb_teacher_settings
  for all to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

drop policy if exists sb_students_owner on public.sb_students;
create policy sb_students_owner on public.sb_students
  for all to authenticated
  using (public.sb_owns_class(class_id)) with check (public.sb_owns_class(class_id));

-- PIN 원문 금고: 담당 교사만. 학생 쪽 경로는 이 표를 아예 읽지 않는다.
drop policy if exists sb_pin_vault_owner on public.sb_student_pin_vault;
create policy sb_pin_vault_owner on public.sb_student_pin_vault
  for select to authenticated
  using (public.sb_owns_class(class_id));

drop policy if exists sb_lesson_settings_owner on public.sb_lesson_settings;
create policy sb_lesson_settings_owner on public.sb_lesson_settings
  for all to authenticated
  using (public.sb_owns_class(class_id)) with check (public.sb_owns_class(class_id));

-- 문제: 교사는 자기 학급 문제와 공용 기본 문제를 본다.
-- 학생에게는 정책을 열지 않는다. 정답이 들어 있기 때문이다.
drop policy if exists sb_problems_teacher_read on public.sb_problems;
create policy sb_problems_teacher_read on public.sb_problems
  for select to authenticated
  using (class_id is null or public.sb_owns_class(class_id));

drop policy if exists sb_problems_teacher_write on public.sb_problems;
create policy sb_problems_teacher_write on public.sb_problems
  for all to authenticated
  using (class_id is not null and public.sb_owns_class(class_id))
  with check (class_id is not null and public.sb_owns_class(class_id));

drop policy if exists sb_progress_owner on public.sb_student_progress;
create policy sb_progress_owner on public.sb_student_progress
  for all to authenticated
  using (public.sb_owns_student(student_id)) with check (public.sb_owns_student(student_id));

drop policy if exists sb_attempts_owner on public.sb_problem_attempts;
create policy sb_attempts_owner on public.sb_problem_attempts
  for all to authenticated
  using (public.sb_owns_student(student_id)) with check (public.sb_owns_student(student_id));

drop policy if exists sb_snapshots_owner on public.sb_block_snapshots;
create policy sb_snapshots_owner on public.sb_block_snapshots
  for all to authenticated
  using (public.sb_owns_student(student_id)) with check (public.sb_owns_student(student_id));

drop policy if exists sb_rewards_owner on public.sb_student_rewards;
create policy sb_rewards_owner on public.sb_student_rewards
  for all to authenticated
  using (public.sb_owns_student(student_id)) with check (public.sb_owns_student(student_id));

drop policy if exists sb_challenges_owner on public.sb_shared_challenges;
create policy sb_challenges_owner on public.sb_shared_challenges
  for all to authenticated
  using (public.sb_owns_class(class_id)) with check (public.sb_owns_class(class_id));

drop policy if exists sb_challenge_solves_owner on public.sb_challenge_solves;
create policy sb_challenge_solves_owner on public.sb_challenge_solves
  for all to authenticated
  using (public.sb_owns_student(student_id)) with check (public.sb_owns_student(student_id));

drop policy if exists sb_projects_owner on public.sb_projects;
create policy sb_projects_owner on public.sb_projects
  for all to authenticated
  using (public.sb_owns_class(class_id)) with check (public.sb_owns_class(class_id));

-- 세션 표는 교사도 직접 읽을 필요가 없다. Edge Function 만 다룬다.
-- (정책을 하나도 만들지 않으므로 anon/authenticated 모두 접근 불가)

-- ===========================================================================
-- 10. 학생 접속 링크용 공개 조회
--     학생 로그인 화면에서 "6학년 3반" 같은 학급 이름만 보여 주기 위한 것.
--     class_code 로만 찾을 수 있고, 학생 명단이나 PIN 은 나오지 않는다.
-- ===========================================================================

create or replace function public.sb_public_class_info(p_class_code text)
returns table (class_id uuid, class_name text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name
  from public.sb_classes c
  where c.class_code = upper(trim(p_class_code))
  limit 1;
$$;

revoke all on function public.sb_public_class_info(text) from public;
grant execute on function public.sb_public_class_info(text) to anon, authenticated;
