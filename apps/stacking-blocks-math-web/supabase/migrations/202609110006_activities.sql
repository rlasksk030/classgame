alter table public.sb_projects add column if not exists version integer not null default 1;
alter table public.sb_challenge_solves add column if not exists wrong_count integer not null default 0;
alter table public.sb_challenge_solves add column if not exists answer_revealed boolean not null default false;
alter table public.sb_challenge_solves add column if not exists xp integer not null default 0;
alter table public.sb_challenge_solves add column if not exists score integer not null default 0 check (score between 0 and 2);
create table if not exists public.sb_self_evaluations (
 student_id uuid primary key references public.sb_students(id) on delete cascade,
 confidence integer not null check(confidence between 1 and 3), reflection text not null default '', updated_at timestamptz not null default now()
);
alter table public.sb_self_evaluations enable row level security;
create policy sb_self_evaluation_teacher on public.sb_self_evaluations for all to authenticated using(public.sb_owns_student(student_id)) with check(public.sb_owns_student(student_id));

create or replace function public.sb_save_building(p_student uuid,p_class uuid,p_version integer,p_data jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare current_version integer; next_version integer;
begin
 perform 1 from public.sb_students where id=p_student and class_id=p_class and status='active' for update;
 if not found then raise exception 'FORBIDDEN_STUDENT'; end if;
 select version into current_version from public.sb_projects where student_id=p_student;
 if coalesce(current_version,0)<>p_version then raise exception 'VERSION_CONFLICT'; end if;
 next_version:=coalesce(current_version,0)+1;
 insert into public.sb_projects(student_id,class_id,building_name,reason,description,layer_notes,blocks,grid_width,grid_depth,max_height,submitted,version)
 values(p_student,p_class,p_data->>'building_name',p_data->>'reason',p_data->>'description',p_data->'layer_notes',p_data->'blocks',5,5,3,(p_data->>'submitted')::boolean,next_version)
 on conflict(student_id) do update set building_name=excluded.building_name,reason=excluded.reason,description=excluded.description,layer_notes=excluded.layer_notes,blocks=excluded.blocks,submitted=excluded.submitted,version=excluded.version;
 if (p_data->>'submitted')::boolean then
   insert into public.sb_student_progress(student_id,lesson,completed,completed_at,stars) values(p_student,10,true,now(),1),(p_student,11,true,now(),1)
   on conflict(student_id,lesson) do update set completed=true,completed_at=now(),stars=1;
 end if;
 return next_version;
end; $$;
revoke all on function public.sb_save_building(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.sb_save_building(uuid,uuid,integer,jsonb) to service_role;

create or replace function public.sb_submit_challenge(p_student uuid,p_challenge uuid,p_previous integer,p_state jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare current_wrong integer;
begin
 perform 1 from public.sb_students s join public.sb_shared_challenges c on c.class_id=s.class_id where s.id=p_student and c.id=p_challenge and s.status='active' for update of s;
 if not found then raise exception 'FORBIDDEN_CLASS'; end if;
 select wrong_count into current_wrong from public.sb_challenge_solves where student_id=p_student and challenge_id=p_challenge;
 if coalesce(current_wrong,0)<>p_previous then raise exception 'VERSION_CONFLICT'; end if;
 insert into public.sb_challenge_solves(challenge_id,student_id,correct,used_hint,wrong_count,answer_revealed,xp)
 values(p_challenge,p_student,(p_state->>'completed')::boolean,(p_state->>'hintShown')::boolean,(p_state->>'wrongCount')::integer,(p_state->>'answerRevealed')::boolean,(p_state->>'xp')::integer)
 on conflict(challenge_id,student_id) do update set correct=excluded.correct,used_hint=excluded.used_hint,wrong_count=excluded.wrong_count,answer_revealed=excluded.answer_revealed,xp=excluded.xp,score=coalesce((p_state->>'score')::integer,0),solved_at=now()
 where not sb_challenge_solves.correct;
 if (p_state->>'completed')::boolean then
 insert into public.sb_student_progress(student_id,lesson,completed,completed_at,stars) values(p_student,9,true,now(),1)
 on conflict(student_id,lesson) do update set completed=true,completed_at=now(),stars=1;
 end if;
end; $$;
revoke all on function public.sb_submit_challenge(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.sb_submit_challenge(uuid,uuid,integer,jsonb) to service_role;
