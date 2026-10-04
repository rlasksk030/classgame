-- Reviewed required-progress delta. Confirm target identity in the private guide.
-- Baseline: metadata captured 2026-10-03 05:17:02 UTC, history latest 202609250001.
-- PR #4 source: 5a90a242925e2d62af0376f6e99d9416c21248e4.
-- NOT APPLIED. Run only this file after the package preflight/Edge-backup gate.
-- No history replay/repair; no existing tables/columns/constraints/policies/grants replaced.
-- Add ONLY missing assignment updated_at, required by its existing touch trigger.
-- Existing signatures/privilege scope stay unchanged. New RPC is service_role only.
-- DELETE below is confined to the explicitly invoked reset RPC, not the migration.
-- Backfill promotes completion only with stored evidence; no completion demotion.
-- New omitted-grid fallback stays actual-use 10, unlike legacy compatibility's 5.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(hashtext('sb_actual_use_required_progress_delta'));
do $guard$ declare n integer; begin
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sb_record_attempt' and pg_get_function_identity_arguments(p.oid)='p_student uuid, p_problem uuid, p_expected integer, p_next jsonb, p_blocks jsonb' and p.prosecdef and p.proconfig=array['search_path=public'] and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}' and md5(pg_get_functiondef(p.oid)) in ('f3b2e832dc4564f4ee70cf0890737de2','9ba8e9f0be51e7cc21fbe73a50bcc24c')) then raise exception 'CATALOG_DRIFT: sb_record_attempt'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sb_save_building' and pg_get_function_identity_arguments(p.oid)='p_student uuid, p_class uuid, p_version integer, p_data jsonb' and p.prosecdef and p.proconfig=array['search_path=public'] and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}' and md5(pg_get_functiondef(p.oid)) in ('09876dea862d49d80815c365ce567b86','f84de03cb768a5ff75467b37160fffb6')) then raise exception 'CATALOG_DRIFT: sb_save_building'; end if;
if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sb_submit_challenge_v2' and pg_get_function_identity_arguments(p.oid)='p_student uuid, p_challenge uuid, p_previous integer, p_state jsonb' and p.prosecdef and p.proconfig=array['search_path=public'] and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}' and md5(pg_get_functiondef(p.oid)) in ('520c390ecd97304b1eea578a4177594d','aabce5bad0823d786caddb671d6323f2')) then raise exception 'CATALOG_DRIFT: sb_submit_challenge_v2'; end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sb_reset_class_progress' and md5(pg_get_functiondef(p.oid))<>'eee3a70d4d341c3cbe512bc64ea3e4f4') then raise exception 'CATALOG_DRIFT: unexpected sb_reset_class_progress'; end if;
if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='sb_track_challenge_author' and md5(pg_get_functiondef(p.oid))<>'f84313392ee30d7a218fcd9f44ee7470') then raise exception 'CATALOG_DRIFT: unexpected sb_track_challenge_author'; end if;
if exists(select 1 from information_schema.columns where table_schema='public' and table_name='sb_practice_assignments' and column_name='updated_at' and (udt_name<>'timestamptz' or is_nullable<>'NO' or column_default is distinct from 'now()')) then raise exception 'CATALOG_DRIFT: assignment updated_at'; end if;
-- Exactly the required actual-use columns; extra operational objects are preserved.
if exists(select 1 from (values
('sb_block_snapshots','id','uuid','NO','gen_random_uuid()',1),
('sb_block_snapshots','student_id','uuid','NO',null::text,2),
('sb_block_snapshots','problem_id','uuid','YES',null::text,3),
('sb_block_snapshots','lesson','int2','NO',null::text,4),
('sb_block_snapshots','blocks','jsonb','NO','''[]''::jsonb',5),
('sb_block_snapshots','grid_width','int2','NO','4',6),
('sb_block_snapshots','grid_depth','int2','NO','4',7),
('sb_block_snapshots','max_height','int2','NO','4',8),
('sb_block_snapshots','label','text','YES',null::text,9),
('sb_block_snapshots','updated_at','timestamptz','NO','now()',10),
('sb_challenge_solves','challenge_id','uuid','NO',null::text,1),
('sb_challenge_solves','student_id','uuid','NO',null::text,2),
('sb_challenge_solves','correct','bool','NO','false',3),
('sb_challenge_solves','used_hint','bool','NO','false',4),
('sb_challenge_solves','solved_at','timestamptz','NO','now()',5),
('sb_challenge_solves','wrong_count','int4','NO','0',6),
('sb_challenge_solves','answer_revealed','bool','NO','false',7),
('sb_challenge_solves','xp','int4','NO','0',8),
('sb_challenge_solves','score','int4','NO','0',9),
('sb_classes','id','uuid','NO','gen_random_uuid()',1),
('sb_classes','teacher_id','uuid','NO',null::text,2),
('sb_classes','name','text','NO',null::text,3),
('sb_classes','class_code','text','NO',null::text,4),
('sb_classes','school_year','int4','NO','EXTRACT(year FROM now())',5),
('sb_classes','created_at','timestamptz','NO','now()',6),
('sb_classes','updated_at','timestamptz','NO','now()',7),
('sb_lesson_progress_records','installation_id','text','NO',null::text,1),
('sb_lesson_progress_records','class_id','uuid','NO',null::text,2),
('sb_lesson_progress_records','student_id','uuid','NO',null::text,3),
('sb_lesson_progress_records','curriculum_version','text','NO',null::text,4),
('sb_lesson_progress_records','lesson','int2','NO',null::text,5),
('sb_lesson_progress_records','stage','text','NO',null::text,6),
('sb_lesson_progress_records','set_id','text','NO',null::text,7),
('sb_lesson_progress_records','problem_id','text','NO',null::text,8),
('sb_lesson_progress_records','problem_version','int4','NO','1',9),
('sb_lesson_progress_records','question_index','int4','NO',null::text,10),
('sb_lesson_progress_records','answer','jsonb','NO','''{}''::jsonb',11),
('sb_lesson_progress_records','first_attempt_result','text','YES',null::text,12),
('sb_lesson_progress_records','attempt_count','int4','NO','0',13),
('sb_lesson_progress_records','hint_level','int2','NO','0',14),
('sb_lesson_progress_records','final_result','text','YES',null::text,15),
('sb_lesson_progress_records','remediation_status','text','NO','''none''::text',16),
('sb_lesson_progress_records','completed_at','timestamptz','YES',null::text,17),
('sb_lesson_progress_records','self_evaluation','jsonb','NO','''{}''::jsonb',18),
('sb_lesson_progress_records','created_at','timestamptz','NO','now()',19),
('sb_lesson_progress_records','updated_at','timestamptz','NO','now()',20),
('sb_lesson_settings','class_id','uuid','NO',null::text,1),
('sb_lesson_settings','lesson','int2','NO',null::text,2),
('sb_lesson_settings','locked','bool','NO','true',3),
('sb_lesson_settings','updated_at','timestamptz','NO','now()',4),
('sb_lesson_settings','practice_count','int2','YES',null::text,5),
('sb_lesson_settings','allow_similar','bool','NO','true',6),
('sb_lesson_settings','allow_retry','bool','NO','true',7),
('sb_peer_problem_attempts','id','uuid','NO','gen_random_uuid()',1),
('sb_peer_problem_attempts','installation_id','text','NO',null::text,2),
('sb_peer_problem_attempts','class_id','uuid','NO',null::text,3),
('sb_peer_problem_attempts','problem_id','uuid','NO',null::text,4),
('sb_peer_problem_attempts','problem_version','int4','NO',null::text,5),
('sb_peer_problem_attempts','student_id','uuid','NO',null::text,6),
('sb_peer_problem_attempts','used_hint','bool','NO','false',7),
('sb_peer_problem_attempts','submitted_answer_json','jsonb','NO','''{}''::jsonb',8),
('sb_peer_problem_attempts','is_correct','bool','NO','false',9),
('sb_peer_problem_attempts','score_awarded','int2','NO','0',10),
('sb_peer_problem_attempts','completed_at','timestamptz','YES',null::text,11),
('sb_peer_problem_attempts','idempotency_key','text','YES',null::text,12),
('sb_peer_problem_attempts','created_at','timestamptz','NO','now()',13),
('sb_peer_problem_attempts','updated_at','timestamptz','NO','now()',14),
('sb_practice_assignments','assignment_id','uuid','NO','gen_random_uuid()',1),
('sb_practice_assignments','installation_id','text','NO',null::text,2),
('sb_practice_assignments','class_id','uuid','NO',null::text,3),
('sb_practice_assignments','student_id','uuid','NO',null::text,4),
('sb_practice_assignments','lesson','int2','NO',null::text,5),
('sb_practice_assignments','curriculum_version','text','NO',null::text,6),
('sb_practice_assignments','set_id','text','NO',null::text,7),
('sb_practice_assignments','seed','int4','NO',null::text,8),
('sb_practice_assignments','problem_ids','jsonb','NO','''[]''::jsonb',9),
('sb_practice_assignments','target_total','int2','NO',null::text,10),
('sb_practice_assignments','active','bool','NO','true',11),
('sb_practice_assignments','created_at','timestamptz','NO','now()',12),
('sb_practice_assignments','deactivated_at','timestamptz','YES',null::text,13),
('sb_problem_attempts','id','uuid','NO','gen_random_uuid()',1),
('sb_problem_attempts','student_id','uuid','NO',null::text,2),
('sb_problem_attempts','problem_id','uuid','NO',null::text,3),
('sb_problem_attempts','lesson','int2','NO',null::text,4),
('sb_problem_attempts','wrong_count','int4','NO','0',5),
('sb_problem_attempts','hint_shown','bool','NO','false',6),
('sb_problem_attempts','answer_revealed','bool','NO','false',7),
('sb_problem_attempts','completed','bool','NO','false',8),
('sb_problem_attempts','attempt_count','int4','NO','0',9),
('sb_problem_attempts','stars','int4','NO','0',10),
('sb_problem_attempts','xp_earned','int4','NO','0',11),
('sb_problem_attempts','first_seen_at','timestamptz','NO','now()',12),
('sb_problem_attempts','completed_at','timestamptz','YES',null::text,13),
('sb_problem_attempts','updated_at','timestamptz','NO','now()',14),
('sb_problems','id','uuid','NO','gen_random_uuid()',1),
('sb_problems','class_id','uuid','YES',null::text,2),
('sb_problems','created_by','uuid','YES',null::text,3),
('sb_problems','code','text','YES',null::text,4),
('sb_problems','lesson','int2','NO',null::text,5),
('sb_problems','order_index','int4','NO','0',6),
('sb_problems','problem_type','text','NO',null::text,7),
('sb_problems','title','text','NO',null::text,8),
('sb_problems','prompt','text','NO','''''::text',9),
('sb_problems','grid_width','int2','NO','4',10),
('sb_problems','grid_depth','int2','NO','4',11),
('sb_problems','max_height','int2','NO','4',12),
('sb_problems','given_blocks','jsonb','NO','''[]''::jsonb',13),
('sb_problems','start_blocks','jsonb','NO','''[]''::jsonb',14),
('sb_problems','given','jsonb','NO','''{}''::jsonb',15),
('sb_problems','choices','jsonb','NO','''[]''::jsonb',16),
('sb_problems','answer','jsonb','NO',null::text,17),
('sb_problems','grading_mode','text','NO','''exact''::text',18),
('sb_problems','hint','text','NO','''''::text',19),
('sb_problems','explanation','text','NO','''''::text',20),
('sb_problems','difficulty','int2','NO','2',21),
('sb_problems','xp','int4','NO','30',22),
('sb_problems','active','bool','NO','true',23),
('sb_problems','created_at','timestamptz','NO','now()',24),
('sb_problems','updated_at','timestamptz','NO','now()',25),
('sb_problems','source_type','text','NO','''BUILT_IN''::text',26),
('sb_problems','image_path','text','YES',null::text,27),
('sb_project_exports','id','uuid','NO','gen_random_uuid()',1),
('sb_project_exports','installation_id','text','NO',null::text,2),
('sb_project_exports','class_id','uuid','NO',null::text,3),
('sb_project_exports','student_id','uuid','NO',null::text,4),
('sb_project_exports','project_id','uuid','YES',null::text,5),
('sb_project_exports','project_version','int4','NO',null::text,6),
('sb_project_exports','export_type','text','NO',null::text,7),
('sb_project_exports','snapshot_json','jsonb','NO','''{}''::jsonb',8),
('sb_project_exports','created_at','timestamptz','NO','now()',9),
('sb_projects','student_id','uuid','NO',null::text,1),
('sb_projects','class_id','uuid','NO',null::text,2),
('sb_projects','building_name','text','NO','''''::text',3),
('sb_projects','reason','text','NO','''''::text',4),
('sb_projects','description','text','NO','''''::text',5),
('sb_projects','layer_notes','jsonb','NO','''[]''::jsonb',6),
('sb_projects','blocks','jsonb','NO','''[]''::jsonb',7),
('sb_projects','grid_width','int2','NO','10',8),
('sb_projects','grid_depth','int2','NO','10',9),
('sb_projects','max_height','int2','NO','5',10),
('sb_projects','capture','text','YES',null::text,11),
('sb_projects','submitted','bool','NO','false',12),
('sb_projects','updated_at','timestamptz','NO','now()',13),
('sb_projects','version','int4','NO','1',14),
('sb_projects','block_appearance','jsonb','NO','''{}''::jsonb',15),
('sb_projects','intro_theme','text','NO','''blueprint''::text',16),
('sb_projects','project_id','uuid','YES','gen_random_uuid()',17),
('sb_self_evaluations','student_id','uuid','NO',null::text,1),
('sb_self_evaluations','confidence','int4','NO',null::text,2),
('sb_self_evaluations','reflection','text','NO','''''::text',3),
('sb_self_evaluations','updated_at','timestamptz','NO','now()',4),
('sb_shared_challenges','id','uuid','NO','gen_random_uuid()',1),
('sb_shared_challenges','class_id','uuid','NO',null::text,2),
('sb_shared_challenges','author_id','uuid','YES',null::text,3),
('sb_shared_challenges','share_code','text','NO',null::text,4),
('sb_shared_challenges','challenge_type','text','NO','''views''::text',5),
('sb_shared_challenges','blocks','jsonb','NO','''[]''::jsonb',6),
('sb_shared_challenges','grid_width','int2','NO','4',7),
('sb_shared_challenges','grid_depth','int2','NO','4',8),
('sb_shared_challenges','max_height','int2','NO','4',9),
('sb_shared_challenges','solved_count','int4','NO','0',10),
('sb_shared_challenges','created_at','timestamptz','NO','now()',11),
('sb_shared_challenges','hint_type','text','NO','''heightMap''::text',12),
('sb_shared_challenges','source','text','NO','''student''::text',13),
('sb_student_created_problems','problem_id','uuid','NO','gen_random_uuid()',1),
('sb_student_created_problems','version','int4','NO',null::text,2),
('sb_student_created_problems','installation_id','text','NO',null::text,3),
('sb_student_created_problems','class_id','uuid','NO',null::text,4),
('sb_student_created_problems','author_student_id','uuid','NO',null::text,5),
('sb_student_created_problems','title','text','NO','''''::text',6),
('sb_student_created_problems','public_problem_json','jsonb','NO','''{}''::jsonb',7),
('sb_student_created_problems','hidden_validation_json','jsonb','NO','''{}''::jsonb',8),
('sb_student_created_problems','hint_type','text','NO',null::text,9),
('sb_student_created_problems','status','text','NO','''draft''::text',10),
('sb_student_created_problems','published_at','timestamptz','YES',null::text,11),
('sb_student_created_problems','hidden_at','timestamptz','YES',null::text,12),
('sb_student_created_problems','created_at','timestamptz','NO','now()',13),
('sb_student_created_problems','updated_at','timestamptz','NO','now()',14),
('sb_student_lesson_reflections','installation_id','text','NO',null::text,1),
('sb_student_lesson_reflections','class_id','uuid','NO',null::text,2),
('sb_student_lesson_reflections','student_id','uuid','NO',null::text,3),
('sb_student_lesson_reflections','lesson','int2','NO',null::text,4),
('sb_student_lesson_reflections','curriculum_version','text','NO',null::text,5),
('sb_student_lesson_reflections','confidence','int2','YES',null::text,6),
('sb_student_lesson_reflections','favorite_concept','text','YES',null::text,7),
('sb_student_lesson_reflections','self_praise','text','NO','''''::text',8),
('sb_student_lesson_reflections','updated_at','timestamptz','NO','now()',9),
('sb_student_pin_vault','student_id','uuid','NO',null::text,1),
('sb_student_pin_vault','class_id','uuid','NO',null::text,2),
('sb_student_pin_vault','pin_plain','text','NO',null::text,3),
('sb_student_pin_vault','issued_at','timestamptz','NO','now()',4),
('sb_student_progress','student_id','uuid','NO',null::text,1),
('sb_student_progress','lesson','int2','NO',null::text,2),
('sb_student_progress','completed','bool','NO','false',3),
('sb_student_progress','completed_at','timestamptz','YES',null::text,4),
('sb_student_progress','stars','int4','NO','0',5),
('sb_student_progress','last_problem_id','uuid','YES',null::text,6),
('sb_student_progress','updated_at','timestamptz','NO','now()',7),
('sb_student_progress','practice_seed','int4','YES',null::text,8),
('sb_student_progress','guided_completed','bool','NO','false',9),
('sb_student_rewards','student_id','uuid','NO',null::text,1),
('sb_student_rewards','total_xp','int4','NO','0',2),
('sb_student_rewards','total_stars','int4','NO','0',3),
('sb_student_rewards','badges','jsonb','NO','''[]''::jsonb',4),
('sb_student_rewards','streak','int4','NO','0',5),
('sb_student_rewards','updated_at','timestamptz','NO','now()',6),
('sb_student_rewards','equipped_material','text','NO','''wood''::text',7),
('sb_student_rewards','intro_theme','text','NO','''blueprint''::text',8),
('sb_student_sessions','id','uuid','NO','gen_random_uuid()',1),
('sb_student_sessions','student_id','uuid','NO',null::text,2),
('sb_student_sessions','class_id','uuid','NO',null::text,3),
('sb_student_sessions','token_hash','text','NO',null::text,4),
('sb_student_sessions','issued_at','timestamptz','NO','now()',5),
('sb_student_sessions','expires_at','timestamptz','NO',null::text,6),
('sb_student_sessions','revoked','bool','NO','false',7),
('sb_students','id','uuid','NO','gen_random_uuid()',1),
('sb_students','class_id','uuid','NO',null::text,2),
('sb_students','name','text','NO',null::text,3),
('sb_students','student_no','int4','YES',null::text,4),
('sb_students','pin_hash','text','NO',null::text,5),
('sb_students','failed_attempts','int4','NO','0',6),
('sb_students','locked_until','timestamptz','YES',null::text,7),
('sb_students','status','text','NO','''active''::text',8),
('sb_students','created_at','timestamptz','NO','now()',9),
('sb_students','updated_at','timestamptz','NO','now()',10),
('sb_teacher_settings','teacher_id','uuid','NO',null::text,1),
('sb_teacher_settings','display_name','text','YES',null::text,2),
('sb_teacher_settings','created_at','timestamptz','NO','now()',3),
('sb_teacher_settings','updated_at','timestamptz','NO','now()',4),
('sb_worksheet_imports','id','uuid','NO','gen_random_uuid()',1),
('sb_worksheet_imports','teacher_id','uuid','NO',null::text,2),
('sb_worksheet_imports','class_id','uuid','NO',null::text,3),
('sb_worksheet_imports','filename','text','NO',null::text,4),
('sb_worksheet_imports','storage_path','text','NO',null::text,5),
('sb_worksheet_imports','status','text','NO','''UPLOADED''::text',6),
('sb_worksheet_imports','created_at','timestamptz','NO','now()',7)
) expected(table_name,column_name,udt_name,is_nullable,column_default,ordinal_position)
left join information_schema.columns c on c.table_schema='public' and c.table_name=expected.table_name and c.column_name=expected.column_name
where c.column_name is null or c.udt_name<>expected.udt_name or c.is_nullable<>expected.is_nullable
 or c.column_default is distinct from expected.column_default or c.ordinal_position<>expected.ordinal_position)
then raise exception 'CATALOG_DRIFT: existing column/default/nullability/order'; end if;
if not exists(select 1 from pg_trigger where tgrelid='public.sb_block_snapshots'::regclass and tgname='sb_block_snapshots_touch' and tgenabled='O' and pg_get_triggerdef(oid)='CREATE TRIGGER sb_block_snapshots_touch BEFORE UPDATE ON public.sb_block_snapshots FOR EACH ROW EXECUTE FUNCTION sb_touch_updated_at()') then raise exception 'CATALOG_DRIFT: sb_block_snapshots_touch'; end if;
if not exists(select 1 from pg_trigger where tgrelid='public.sb_classes'::regclass and tgname='sb_classes_touch' and tgenabled='O' and pg_get_triggerdef(oid)='CREATE TRIGGER sb_classes_touch BEFORE UPDATE ON public.sb_classes FOR EACH ROW EXECUTE FUNCTION sb_touch_updated_at()') then raise exception 'CATALOG_DRIFT: sb_classes_touch'; end if;
if not exists(select 1 from pg_trigger where tgrelid='public.sb_lesson_progress_records'::regclass and tgname='sb_lesson_progress_records_touch' and tgenabled='O' and pg_get_triggerdef(oid)='CREATE TRIGGER sb_lesson_progress_records_touch BEFORE UPDATE ON public.sb_lesson_progress_records FOR EACH ROW EXECUTE FUNCTION sb_touch_updated_at()') then raise exception 'CATALOG_DRIFT: sb_lesson_progress_records_touch'; end if;
if not exists(select 1 from pg_trigger where tgrelid='public.sb_lesson_settings'::regclass and tgname='sb_lesson_settings_touch' and tgenabled='O' and pg_get_triggerdef(oid)='CREATE TRIGGER sb_lesson_settings_touch BEFORE UPDATE ON public.sb_lesson_settings FOR EACH ROW EXECUTE FUNCTION sb_touch_updated_at()') then raise exception 'CATALOG_DRIFT: sb_lesson_settings_touch'; end if;
if not exists(select 1 from pg_trigger where tgrelid='public.sb_peer_problem_attempts'::regclass and tgname='sb_peer_problem_attempts_touch' and tgenabled='O' and pg_get_triggerdef(oid)='CREATE TRIGGER sb_peer_problem_attempts_touch BEFORE UPDATE ON public.sb_peer_problem_attempts FOR EACH ROW EXECUTE FUNCTION sb_touch_updated_at()') then raise exception 'CATALOG_DRIFT: sb_peer_problem_attempts_touch'; end if;
if not exists(select 1 from pg_trigger where tgrelid='public.sb_practice_assignments'::regclass and tgname='sb_practice_assignments_touch' and tgenabled='O' and pg_get_triggerdef(oid)='CREATE TRIGGER sb_practice_assignments_touch BEFORE UPDATE ON public.sb_practice_assignments FOR EACH ROW EXECUTE FUNCTION sb_touch_updated_at()') then raise exception 'CATALOG_DRIFT: sb_practice_assignments_touch'; end if;
if not exists(select 1 from pg_trigger where tgrelid='public.sb_problem_attempts'::regclass and tgname='sb_problem_attempts_touch' and tgenabled='O' and pg_get_triggerdef(oid)='CREATE TRIGGER sb_problem_attempts_touch BEFORE UPDATE ON public.sb_problem_attempts FOR EACH ROW EXECUTE FUNCTION sb_touch_updated_at()') then raise exception 'CATALOG_DRIFT: sb_problem_attempts_touch'; end if;
if not exists(select 1 from pg_trigger where tgrelid='public.sb_problems'::regclass and tgname='sb_problems_touch' and tgenabled='O' and pg_get_triggerdef(oid)='CREATE TRIGGER sb_problems_touch BEFORE UPDATE ON public.sb_problems FOR EACH ROW EXECUTE FUNCTION sb_touch_updated_at()') then raise exception 'CATALOG_DRIFT: sb_problems_touch'; end if;
if not exists(select 1 from pg_trigger where tgrelid='public.sb_projects'::regclass and tgname='sb_projects_touch' and tgenabled='O' and pg_get_triggerdef(oid)='CREATE TRIGGER sb_projects_touch BEFORE UPDATE ON public.sb_projects FOR EACH ROW EXECUTE FUNCTION sb_touch_updated_at()') then raise exception 'CATALOG_DRIFT: sb_projects_touch'; end if;
if not exists(select 1 from pg_trigger where tgrelid='public.sb_student_created_problems'::regclass and tgname='sb_student_created_problems_touch' and tgenabled='O' and pg_get_triggerdef(oid)='CREATE TRIGGER sb_student_created_problems_touch BEFORE UPDATE ON public.sb_student_created_problems FOR EACH ROW EXECUTE FUNCTION sb_touch_updated_at()') then raise exception 'CATALOG_DRIFT: sb_student_created_problems_touch'; end if;
if not exists(select 1 from pg_trigger where tgrelid='public.sb_student_lesson_reflections'::regclass and tgname='sb_student_lesson_reflections_touch' and tgenabled='O' and pg_get_triggerdef(oid)='CREATE TRIGGER sb_student_lesson_reflections_touch BEFORE UPDATE ON public.sb_student_lesson_reflections FOR EACH ROW EXECUTE FUNCTION sb_touch_updated_at()') then raise exception 'CATALOG_DRIFT: sb_student_lesson_reflections_touch'; end if;
if not exists(select 1 from pg_trigger where tgrelid='public.sb_student_progress'::regclass and tgname='sb_student_progress_touch' and tgenabled='O' and pg_get_triggerdef(oid)='CREATE TRIGGER sb_student_progress_touch BEFORE UPDATE ON public.sb_student_progress FOR EACH ROW EXECUTE FUNCTION sb_touch_updated_at()') then raise exception 'CATALOG_DRIFT: sb_student_progress_touch'; end if;
if not exists(select 1 from pg_trigger where tgrelid='public.sb_student_rewards'::regclass and tgname='sb_student_rewards_touch' and tgenabled='O' and pg_get_triggerdef(oid)='CREATE TRIGGER sb_student_rewards_touch BEFORE UPDATE ON public.sb_student_rewards FOR EACH ROW EXECUTE FUNCTION sb_touch_updated_at()') then raise exception 'CATALOG_DRIFT: sb_student_rewards_touch'; end if;
if not exists(select 1 from pg_trigger where tgrelid='public.sb_students'::regclass and tgname='sb_students_touch' and tgenabled='O' and pg_get_triggerdef(oid)='CREATE TRIGGER sb_students_touch BEFORE UPDATE ON public.sb_students FOR EACH ROW EXECUTE FUNCTION sb_touch_updated_at()') then raise exception 'CATALOG_DRIFT: sb_students_touch'; end if;
if not exists(select 1 from pg_trigger where tgrelid='public.sb_teacher_settings'::regclass and tgname='sb_teacher_settings_touch' and tgenabled='O' and pg_get_triggerdef(oid)='CREATE TRIGGER sb_teacher_settings_touch BEFORE UPDATE ON public.sb_teacher_settings FOR EACH ROW EXECUTE FUNCTION sb_touch_updated_at()') then raise exception 'CATALOG_DRIFT: sb_teacher_settings_touch'; end if;
if not exists(select 1 from pg_trigger where tgrelid='public.sb_student_progress'::regclass and tgname='sb_student_progress_touch' and tgenabled='O' and not tgisinternal) then raise exception 'CATALOG_DRIFT: progress touch trigger'; end if;
if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'sb\_%' escape '\' and c.relkind='r' and not c.relrowsecurity) then raise exception 'CATALOG_DRIFT: RLS'; end if;
end $guard$;
-- Block concurrent student writes while repairing evidence; timeout means full rollback.
lock table public.sb_students,public.sb_problem_attempts,public.sb_projects,
 public.sb_challenge_solves,public.sb_shared_challenges in share row exclusive mode;

-- The current assignment touch trigger references a missing field.
alter table public.sb_practice_assignments add column if not exists updated_at timestamptz not null default now();
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

create or replace function public.sb_save_building(p_student uuid,p_class uuid,p_version integer,p_data jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare
  current_version integer; next_version integer;
  requested_width integer; requested_depth integer; requested_height integer;
  material text; theme text; xp integer; prior public.sb_projects;
begin
  perform 1 from public.sb_students where id=p_student and class_id=p_class and status='active' for update;
  if not found then raise exception 'FORBIDDEN_STUDENT'; end if;
  select * into prior from public.sb_projects where student_id=p_student;
  current_version := prior.version;
  if coalesce(current_version,0)<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  next_version:=coalesce(current_version,0)+1;
  requested_width := case when coalesce(p_data->>'grid_width','') ~ '^[0-9]+$' then (p_data->>'grid_width')::integer else coalesce(prior.grid_width,10) end;
  requested_depth := case when coalesce(p_data->>'grid_depth','') ~ '^[0-9]+$' then (p_data->>'grid_depth')::integer else coalesce(prior.grid_depth,10) end;
  requested_height := case when coalesce(p_data->>'max_height','') ~ '^[0-9]+$' then (p_data->>'max_height')::integer else 3 end;
  requested_width := greatest(4, least(10, requested_width)); requested_depth := greatest(4, least(10, requested_depth)); requested_height := 3;
  xp := coalesce((select total_xp from public.sb_student_rewards where student_id=p_student),0);
  material := coalesce((select equipped_material from public.sb_student_rewards where student_id=p_student),'wood');
  theme := coalesce(p_data->>'intro_theme', prior.intro_theme, coalesce((select intro_theme from public.sb_student_rewards where student_id=p_student),'blueprint'));
  if theme not in ('blueprint','museum','sky') then theme := 'blueprint'; end if;
  if p_data ? 'intro_theme' and ((theme='museum' and xp<250) or (theme='sky' and xp<450)) then theme := 'blueprint'; end if;
  insert into public.sb_projects(student_id,class_id,building_name,reason,description,layer_notes,blocks,block_appearance,intro_theme,grid_width,grid_depth,max_height,submitted,version)
  values(p_student,p_class,p_data->>'building_name',p_data->>'reason',p_data->>'description',p_data->'layer_notes',p_data->'blocks',coalesce(p_data->'block_appearance',prior.block_appearance,'{}'::jsonb),theme,requested_width,requested_depth,requested_height,(p_data->>'submitted')::boolean,next_version)
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
do $$ begin
 if not exists(select 1 from pg_trigger where tgrelid='public.sb_shared_challenges'::regclass and tgname='sb_track_challenge_author') then
 create trigger sb_track_challenge_author after insert on public.sb_shared_challenges
 for each row execute function public.sb_track_challenge_author();
 end if;
end $$;


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

-- Historical evidence backfill (separate from RPC definitions).
-- Promote only completion fields from saved evidence, keeping last activity,
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
 select student_id,lesson from required where total>0 and total=done
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
