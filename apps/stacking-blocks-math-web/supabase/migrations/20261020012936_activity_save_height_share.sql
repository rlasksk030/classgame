-- Additive activity contract v2. No historical rows are rewritten.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table public.sb_shared_challenges add column if not exists client_request_id uuid;
create unique index if not exists sb_challenge_request_key on public.sb_shared_challenges(author_id,client_request_id) where client_request_id is not null;
alter table public.sb_projects add column if not exists share_slug text;
alter table public.sb_projects add column if not exists shared_version integer;
create unique index if not exists sb_project_share_slug on public.sb_projects(share_slug) where share_slug is not null;

create or replace function public.sb_activity_contract() returns integer language sql stable set search_path=public as $$select 2$$;
revoke all on function public.sb_activity_contract() from public,anon,authenticated;
grant execute on function public.sb_activity_contract() to service_role;

create or replace function public.sb_valid_activity_blocks(b jsonb,w integer,d integer,h integer)
returns boolean language plpgsql immutable set search_path=public as $$
declare v jsonb; x integer; y integer; z integer;
begin
 if jsonb_typeof(b) is distinct from 'array' or w not between 4 and 10 or d not between 4 and 10 or h not between 1 and 10 then return false; end if;
 if jsonb_array_length(b)>1000 then return false; end if;
 if (select count(*) from (select distinct e->>'x',e->>'y',e->>'z' from jsonb_array_elements(b) e) q)<>jsonb_array_length(b) then return false; end if;
 for v in select * from jsonb_array_elements(b) loop
  if not coalesce((v->>'x') ~ '^[0-9]+$' and (v->>'y') ~ '^[0-9]+$' and (v->>'z') ~ '^[0-9]+$',false) then return false; end if;
  x:=(v->>'x')::integer; y:=(v->>'y')::integer; z:=(v->>'z')::integer;
  if x>=w or z>=d or y>=h then return false; end if;
  if y>0 and not b @> jsonb_build_array(jsonb_build_object('x',x,'y',y-1,'z',z)) then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;
revoke all on function public.sb_valid_activity_blocks(jsonb,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.sb_valid_activity_blocks(jsonb,integer,integer,integer) to service_role;

create or replace function public.sb_save_building(p_student uuid,p_class uuid,p_version integer,p_data jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare
 prior public.sb_projects; next_version integer; w integer; d integer; h integer;
 xp integer; theme text; completing boolean; lesson_number integer; notes jsonb;
begin
 perform 1 from public.sb_students where id=p_student and class_id=p_class and status='active' for update;
 if not found then raise exception 'FORBIDDEN_STUDENT'; end if;
 completing:=coalesce((p_data->>'submitted')::boolean,false);
 lesson_number:=coalesce((p_data->>'progress_lesson')::integer,case when completing then 11 else 10 end);
 if lesson_number not in(10,11) or (completing and lesson_number<>11) then raise exception 'INVALID_BUILDING'; end if;
 if not exists(select 1 from public.sb_lesson_settings where class_id=p_class and lesson=lesson_number and not locked) then raise exception 'LESSON_LOCKED'; end if;
 select * into prior from public.sb_projects where student_id=p_student;
 if coalesce(prior.version,0) is distinct from p_version then raise exception 'VERSION_CONFLICT'; end if;
 next_version:=coalesce(prior.version,0)+1;
 w:=coalesce((p_data->>'grid_width')::integer,prior.grid_width,5);
 d:=coalesce((p_data->>'grid_depth')::integer,prior.grid_depth,5);
 h:=coalesce((p_data->>'max_height')::integer,prior.max_height,3);
 notes:=p_data->'layer_notes';
 if not public.sb_valid_activity_blocks(p_data->'blocks',w,d,h) or jsonb_typeof(notes) is distinct from 'array' then raise exception 'INVALID_BUILDING'; end if;
 if jsonb_array_length(notes) not between 3 and 10 then raise exception 'INVALID_BUILDING'; end if;
 if exists(select 1 from jsonb_array_elements(notes || jsonb_build_array(p_data->'building_name',p_data->'reason',p_data->'description')) t where jsonb_typeof(t) is distinct from 'string' or length(t#>>'{}')>2000) then raise exception 'INVALID_BUILDING'; end if;
 if completing and (length(trim(p_data->>'building_name'))=0 or length(trim(p_data->>'reason'))=0 or length(trim(p_data->>'description'))=0 or jsonb_array_length(p_data->'blocks')=0 or exists(select 1 from jsonb_array_elements(p_data->'blocks') b where length(trim(coalesce(notes->>((b->>'y')::int),'')))=0)) then raise exception 'INVALID_BUILDING'; end if;
 xp:=coalesce((select total_xp from public.sb_student_rewards where student_id=p_student),0);
 theme:=coalesce(p_data->>'intro_theme',prior.intro_theme,'blueprint');
 if theme not in('blueprint','museum','sky') or (p_data ? 'intro_theme' and ((theme='museum' and xp<250) or (theme='sky' and xp<450))) then theme:='blueprint'; end if;
 insert into public.sb_projects(student_id,class_id,building_name,reason,description,layer_notes,blocks,block_appearance,intro_theme,grid_width,grid_depth,max_height,submitted,version)
 values(p_student,p_class,p_data->>'building_name',p_data->>'reason',p_data->>'description',notes,p_data->'blocks',coalesce(p_data->'block_appearance',prior.block_appearance,'{}'::jsonb),theme,w,d,h,completing,next_version)
 on conflict(student_id) do update set building_name=excluded.building_name,reason=excluded.reason,description=excluded.description,layer_notes=excluded.layer_notes,blocks=excluded.blocks,block_appearance=excluded.block_appearance,intro_theme=excluded.intro_theme,grid_width=excluded.grid_width,grid_depth=excluded.grid_depth,max_height=excluded.max_height,submitted=excluded.submitted,version=excluded.version,share_slug=null,shared_version=null;
 insert into public.sb_student_progress(student_id,lesson) values(p_student,lesson_number) on conflict(student_id,lesson) do update set updated_at=now();
 if completing then
  insert into public.sb_student_progress(student_id,lesson,completed,completed_at,stars) values(p_student,10,true,now(),1),(p_student,11,true,now(),1)
  on conflict(student_id,lesson) do update set completed=true,completed_at=coalesce(sb_student_progress.completed_at,excluded.completed_at),stars=greatest(sb_student_progress.stars,1);
 end if;
 return next_version;
end $$;
revoke all on function public.sb_save_building(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.sb_save_building(uuid,uuid,integer,jsonb) to service_role;

create or replace function public.sb_create_challenge(p_student uuid,p_class uuid,p_request uuid,p_code text,p_blocks jsonb,p_type text,p_hint text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare prior public.sb_shared_challenges;
begin
 perform 1 from public.sb_students where id=p_student and class_id=p_class and status='active' for update;
 if not found then raise exception 'FORBIDDEN_STUDENT'; end if;
 if not exists(select 1 from public.sb_lesson_settings where class_id=p_class and lesson=9 and not locked) then raise exception 'LESSON_LOCKED'; end if;
 if p_request is null or p_code !~ '^[A-Z0-9]{6}$' or p_type not in('views','top','heightMap','layers') or p_hint not in('views','top','heightMap','layers') or not public.sb_valid_activity_blocks(p_blocks,5,5,3) or jsonb_array_length(p_blocks)<>10 then raise exception 'INVALID_CHALLENGE'; end if;
 select * into prior from public.sb_shared_challenges where author_id=p_student and client_request_id=p_request;
 if found then
  if prior.class_id<>p_class or prior.blocks<>p_blocks or prior.challenge_type<>p_type or prior.hint_type<>p_hint then raise exception 'REQUEST_CONFLICT'; end if;
 else
  insert into public.sb_shared_challenges(class_id,author_id,client_request_id,share_code,challenge_type,hint_type,blocks,grid_width,grid_depth,max_height,source)
   values(p_class,p_student,p_request,p_code,p_type,p_hint,p_blocks,5,5,3,'student') returning * into prior;
 end if;
 return jsonb_build_object('code',prior.share_code,'requestId',prior.client_request_id,'created_at',prior.created_at);
end $$;
revoke all on function public.sb_create_challenge(uuid,uuid,uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.sb_create_challenge(uuid,uuid,uuid,text,jsonb,text,text) to service_role;

create or replace function public.sb_share_building(p_student uuid,p_class uuid,p_version integer,p_enable boolean)
returns text language plpgsql security definer set search_path=public as $$
declare prior public.sb_projects; slug text;
begin
 perform 1 from public.sb_students where id=p_student and class_id=p_class and status='active' for update;
 if not found then raise exception 'FORBIDDEN_STUDENT'; end if;
 if not exists(select 1 from public.sb_lesson_settings where class_id=p_class and lesson=11 and not locked) then raise exception 'LESSON_LOCKED'; end if;
 select * into prior from public.sb_projects where student_id=p_student and class_id=p_class;
 if not found then raise exception 'NOT_FOUND'; end if;
 if p_enable then
  if prior.version is distinct from p_version then raise exception 'VERSION_CONFLICT'; end if;
  if not prior.submitted then raise exception 'NOT_COMPLETED'; end if;
  slug:=coalesce(prior.share_slug,replace(gen_random_uuid()::text,'-',''));
 end if;
 update public.sb_projects set share_slug=slug,shared_version=case when p_enable then version else null end where student_id=p_student;
 return slug;
end $$;
revoke all on function public.sb_share_building(uuid,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.sb_share_building(uuid,uuid,integer,boolean) to service_role;
commit;
