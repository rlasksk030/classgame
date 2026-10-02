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
