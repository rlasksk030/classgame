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
