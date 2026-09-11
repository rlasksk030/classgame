create or replace function public.sb_reset_progress(p_student uuid,p_lesson integer default null)
returns void language plpgsql security invoker set search_path=public as $$
begin
 if not public.sb_owns_student(p_student) then raise exception 'FORBIDDEN_STUDENT'; end if;
 if p_lesson is not null and (p_lesson<1 or p_lesson>12) then raise exception 'BAD_LESSON'; end if;
 perform 1 from public.sb_students where id=p_student for update;
 delete from public.sb_problem_attempts where student_id=p_student and (p_lesson is null or lesson=p_lesson);
 delete from public.sb_block_snapshots where student_id=p_student and (p_lesson is null or lesson=p_lesson);
 delete from public.sb_student_progress where student_id=p_student and (p_lesson is null or lesson=p_lesson or (p_lesson in (10,11) and lesson in (10,11)));
 if p_lesson is null or p_lesson=9 then delete from public.sb_challenge_solves where student_id=p_student; end if;
 if p_lesson is null or p_lesson in (10,11) then delete from public.sb_projects where student_id=p_student; end if;
 if p_lesson is null or p_lesson=12 then delete from public.sb_self_evaluations where student_id=p_student; end if;
 insert into public.sb_student_rewards(student_id,total_xp,total_stars)
 select p_student,coalesce(sum(xp_earned),0),coalesce(sum(stars),0) from public.sb_problem_attempts where student_id=p_student
 on conflict(student_id) do update set total_xp=excluded.total_xp,total_stars=excluded.total_stars,badges='[]',streak=0;
end; $$;
revoke all on function public.sb_reset_progress(uuid,integer) from public,anon;
grant execute on function public.sb_reset_progress(uuid,integer) to authenticated;
