-- 건축 프로젝트 전용 넓은 작업판(8×8) 메타데이터를 저장한다.
-- 기존 5×5 저장물은 p_data에 값이 없을 때 5×5로 보존한다.
create or replace function public.sb_save_building(p_student uuid,p_class uuid,p_version integer,p_data jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare
  current_version integer;
  next_version integer;
  requested_width integer;
  requested_depth integer;
  requested_height integer;
begin
  perform 1 from public.sb_students where id=p_student and class_id=p_class and status='active' for update;
  if not found then raise exception 'FORBIDDEN_STUDENT'; end if;
  select version into current_version from public.sb_projects where student_id=p_student;
  if coalesce(current_version,0)<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  next_version:=coalesce(current_version,0)+1;

  requested_width := case when coalesce(p_data->>'grid_width','') ~ '^[0-9]+$' then (p_data->>'grid_width')::integer else 5 end;
  requested_depth := case when coalesce(p_data->>'grid_depth','') ~ '^[0-9]+$' then (p_data->>'grid_depth')::integer else 5 end;
  requested_height := case when coalesce(p_data->>'max_height','') ~ '^[0-9]+$' then (p_data->>'max_height')::integer else 3 end;
  requested_width := greatest(4, least(10, requested_width));
  requested_depth := greatest(4, least(10, requested_depth));
  requested_height := greatest(3, least(3, requested_height));

  insert into public.sb_projects(student_id,class_id,building_name,reason,description,layer_notes,blocks,grid_width,grid_depth,max_height,submitted,version)
  values(p_student,p_class,p_data->>'building_name',p_data->>'reason',p_data->>'description',p_data->'layer_notes',p_data->'blocks',requested_width,requested_depth,requested_height,(p_data->>'submitted')::boolean,next_version)
  on conflict(student_id) do update set
    building_name=excluded.building_name,reason=excluded.reason,description=excluded.description,layer_notes=excluded.layer_notes,blocks=excluded.blocks,
    grid_width=excluded.grid_width,grid_depth=excluded.grid_depth,max_height=excluded.max_height,submitted=excluded.submitted,version=excluded.version;
  if (p_data->>'submitted')::boolean then
    insert into public.sb_student_progress(student_id,lesson,completed,completed_at,stars) values(p_student,10,true,now(),1),(p_student,11,true,now(),1)
    on conflict(student_id,lesson) do update set completed=true,completed_at=now(),stars=1;
  end if;
  return next_version;
end; $$;

revoke all on function public.sb_save_building(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.sb_save_building(uuid,uuid,integer,jsonb) to service_role;
