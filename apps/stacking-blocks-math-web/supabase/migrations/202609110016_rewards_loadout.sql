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

-- 기존 저장 함수에 외형/테마를 함께 보존한다. 블록 좌표는 기존 검증을 통과한 값만 받는다.
create or replace function public.sb_save_building(p_student uuid,p_class uuid,p_version integer,p_data jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare
  current_version integer; next_version integer;
  requested_width integer; requested_depth integer; requested_height integer;
  material text; theme text; xp integer;
begin
  perform 1 from public.sb_students where id=p_student and class_id=p_class and status='active' for update;
  if not found then raise exception 'FORBIDDEN_STUDENT'; end if;
  select version into current_version from public.sb_projects where student_id=p_student;
  if coalesce(current_version,0)<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  next_version:=coalesce(current_version,0)+1;
  requested_width := case when coalesce(p_data->>'grid_width','') ~ '^[0-9]+$' then (p_data->>'grid_width')::integer else 10 end;
  requested_depth := case when coalesce(p_data->>'grid_depth','') ~ '^[0-9]+$' then (p_data->>'grid_depth')::integer else 10 end;
  requested_height := case when coalesce(p_data->>'max_height','') ~ '^[0-9]+$' then (p_data->>'max_height')::integer else 3 end;
  requested_width := greatest(4, least(10, requested_width)); requested_depth := greatest(4, least(10, requested_depth)); requested_height := 3;
  xp := coalesce((select total_xp from public.sb_student_rewards where student_id=p_student),0);
  material := coalesce((select equipped_material from public.sb_student_rewards where student_id=p_student),'wood');
  theme := coalesce(p_data->>'intro_theme', coalesce((select intro_theme from public.sb_student_rewards where student_id=p_student),'blueprint'));
  if theme not in ('blueprint','museum','sky') then theme := 'blueprint'; end if;
  if (theme='museum' and xp<250) or (theme='sky' and xp<450) then theme := 'blueprint'; end if;
  insert into public.sb_projects(student_id,class_id,building_name,reason,description,layer_notes,blocks,block_appearance,intro_theme,grid_width,grid_depth,max_height,submitted,version)
  values(p_student,p_class,p_data->>'building_name',p_data->>'reason',p_data->>'description',p_data->'layer_notes',p_data->'blocks',coalesce(p_data->'block_appearance','{}'::jsonb),theme,requested_width,requested_depth,requested_height,(p_data->>'submitted')::boolean,next_version)
  on conflict(student_id) do update set building_name=excluded.building_name,reason=excluded.reason,description=excluded.description,layer_notes=excluded.layer_notes,blocks=excluded.blocks,block_appearance=excluded.block_appearance,intro_theme=excluded.intro_theme,grid_width=excluded.grid_width,grid_depth=excluded.grid_depth,max_height=excluded.max_height,submitted=excluded.submitted,version=excluded.version;
  if (p_data->>'submitted')::boolean then
    insert into public.sb_student_progress(student_id,lesson,completed,completed_at,stars) values(p_student,10,true,now(),1),(p_student,11,true,now(),1)
    on conflict(student_id,lesson) do update set completed=true,completed_at=now(),stars=1;
  end if;
  return next_version;
end; $$;
revoke all on function public.sb_save_building(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.sb_save_building(uuid,uuid,integer,jsonb) to service_role;
