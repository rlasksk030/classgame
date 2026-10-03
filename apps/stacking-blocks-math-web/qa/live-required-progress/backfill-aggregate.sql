BEGIN READ ONLY;
with required as (
 select s.id student_id,p.lesson,count(*) total,count(*) filter(where a.completed) done,
 max(coalesce(a.completed_at,a.updated_at)) filter(where a.completed) completed_at
 from public.sb_students s join public.sb_problems p on (p.class_id is null or p.class_id=s.class_id)
 and p.active and p.order_index=2 and (p.lesson between 1 and 8 or p.lesson=12)
 left join public.sb_problem_attempts a on a.student_id=s.id and a.problem_id=p.id group by s.id,p.lesson
), required_changes as (
 select r.*,(old.student_id is null) missing,old.completed old_completed from required r left join public.sb_student_progress old using(student_id,lesson)
 where r.total>0 and r.total=r.done and (old.student_id is null or not old.completed or old.completed_at is null)
), activity_evidence as (
 select a.student_id,9 lesson,bool_or(a.correct) completed,max(a.solved_at) filter(where a.correct) completed_at,max(a.solved_at) updated_at
 from public.sb_challenge_solves a join public.sb_shared_challenges c on c.id=a.challenge_id
 join public.sb_students s on s.id=a.student_id and s.class_id=c.class_id where c.author_id is distinct from s.id group by a.student_id
 union all select c.author_id,9,false,null::timestamptz,max(c.created_at)
 from public.sb_shared_challenges c join public.sb_students s on s.id=c.author_id and s.class_id=c.class_id group by c.author_id
 union all select p.student_id,l.lesson,p.submitted,case when p.submitted then p.updated_at else null end,p.updated_at
 from public.sb_projects p join public.sb_students s on s.id=p.student_id and s.class_id=p.class_id cross join (values(10),(11)) l(lesson)
 where l.lesson=10 or p.submitted
), activity as (
 select student_id,lesson,bool_or(completed) completed,max(completed_at) completed_at,max(updated_at) updated_at
 from activity_evidence group by student_id,lesson
), activity_changes as (
 select a.*,(old.student_id is null) missing from activity a left join public.sb_student_progress old using(student_id,lesson)
 where old.student_id is null or (a.completed and not old.completed)
)
select jsonb_build_object('captured_at',now(),'transaction_read_only',current_setting('transaction_read_only'),
 'required_inserts',(select count(*) from required_changes where missing),
 'required_false_to_true',(select count(*) from required_changes where not missing and not old_completed),
 'required_timestamp_repairs',(select count(*) from required_changes where not missing and old_completed),
 'required_promotions',(select count(*) from required_changes where not missing),
 'activity_inserts',(select count(*) from activity_changes where missing),
 'activity_completed_inserts',(select count(*) from activity_changes where missing and completed),
 'activity_promotions',(select count(*) from activity_changes where not missing),
 'total_changed_rows',(select count(*) from required_changes)+(select count(*) from activity_changes)) aggregate;
COMMIT;
