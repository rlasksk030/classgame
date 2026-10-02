-- Activity participation and idempotent completion repair. Apply only after deployment approval.
begin;
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
drop trigger if exists sb_track_challenge_author on public.sb_shared_challenges;
create trigger sb_track_challenge_author after insert on public.sb_shared_challenges
 for each row execute function public.sb_track_challenge_author();

-- Recompute only completion fields from saved evidence, keeping last activity,
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
 select student_id,lesson from required where total=done
 union select student_id,lesson from public.sb_student_progress where lesson between 1 and 8 or lesson=12
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
commit;
