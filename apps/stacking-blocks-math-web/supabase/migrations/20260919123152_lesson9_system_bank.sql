-- Additive: existing student challenges and records remain unchanged.
begin;
alter table public.sb_shared_challenges alter column author_id drop not null;
alter table public.sb_shared_challenges add column if not exists source text not null default 'student';
alter table public.sb_shared_challenges add constraint sb_challenge_source check
 ((source='student' and author_id is not null) or (source='system' and author_id is null));

-- Serialize per student; hint state and completion cannot be rolled back by stale tabs.
create function public.sb_submit_challenge_v2(p_student uuid,p_challenge uuid,p_previous integer,p_state jsonb)
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
 if awarded then
 insert into public.sb_student_progress(student_id,lesson,completed,completed_at,stars) values(p_student,9,true,now(),1)
 on conflict(student_id,lesson) do update set completed=true,completed_at=coalesce(sb_student_progress.completed_at,now()),stars=greatest(sb_student_progress.stars,1);
 end if;
 return jsonb_build_object('state',to_jsonb(result),'awarded',awarded);
end; $$;
revoke all on function public.sb_submit_challenge_v2(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.sb_submit_challenge_v2(uuid,uuid,integer,jsonb) to service_role;
commit;
