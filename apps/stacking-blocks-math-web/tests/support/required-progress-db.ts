/** Synthetic identities; actual PostgreSQL migrations, grading and persistence functions. */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { grade } from '../../shared/grading.ts';
import { applyAttempt, INITIAL_ATTEMPT } from '../../shared/attempts.ts';
import { requiredSolveIds } from '../../shared/lessonProgression.ts';
import { summarizeStudentProgress, type ProgressSourceRow, type AttemptSourceRow } from '../../shared/teacherProgress.ts';
import type { ProblemAnswer, ProblemGiven, ProblemType, StudentSubmission } from '../../shared/types.ts';

export const TEACHER = '11111111-1111-4111-8111-111111111111';
export const CLASS = '33333333-3333-4333-8333-333333333333';
export const OTHER_CLASS = '44444444-4444-4444-8444-444444444444';
export const STUDENTS = ['55555555-5555-4555-8555-555555555551', '55555555-5555-4555-8555-555555555552', '55555555-5555-4555-8555-555555555553'];
export const OTHER_STUDENT = '55555555-5555-4555-8555-555555555554';
export const REQUIRED_LESSONS = [1,2,3,4,5,6,7,8,12];
export type Db = InstanceType<typeof PGlite>;

export interface ProblemRow {
  id: string; code: string; lesson: number; order_index: number; problem_type: ProblemType;
  grading_mode: 'exact' | 'constraint'; answer: ProblemAnswer; given: ProblemGiven;
  grid_width: number; grid_depth: number; max_height: number;
}

export async function setupRequiredProgressDb(dataDir?: string, options: { legacyCompletion?: boolean } = {}): Promise<Db> {
  const db = new PGlite(dataDir);
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to anon,authenticated,service_role;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;`);
  for (const file of readdirSync('supabase/migrations').sort()) {
    if(options.legacyCompletion && file.endsWith('_required_lesson_completion.sql')) continue;
    await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8').replace('create extension if not exists "pgcrypto";', ''));
  }
  await db.query('insert into auth.users(id) values($1)', [TEACHER]);
  for (const [id, code] of [[CLASS, 'REQPROGRESS'], [OTHER_CLASS, 'OTHERREQ']]) {
    await db.query('insert into sb_classes(id,teacher_id,name,class_code) values($1,$2,$3,$4)', [id,TEACHER,'합성 진도 검증반',code]);
    for(let lesson=1;lesson<=12;lesson++) await db.query('insert into sb_lesson_settings(class_id,lesson,locked) values($1,$2,false)', [id,lesson]);
  }
  for(const [i,id] of [...STUDENTS,OTHER_STUDENT].entries()) {
    await db.query('insert into sb_students(id,class_id,name,student_no,pin_hash) values($1,$2,$3,$4,$5)',[id,id===OTHER_STUDENT?OTHER_CLASS:CLASS,`합성학생${i+1}`,i+1,'synthetic-not-a-login-secret']);
  }
  return db;
}

export async function submitProblem(db: Db, studentId: string, problemId: string, submission?: StudentSubmission) {
  const problem = (await db.query<ProblemRow>('select * from sb_problems where id=$1',[problemId])).rows[0];
  assert.ok(problem, 'test problem exists');
  // L6's answer contract stores projection constraints, while the submitted
  // answer is a concrete 9-block structure. This fixed witness is independent
  // of both the production solver and the fixture's answer object.
  const l6Witness: StudentSubmission = {kind:'blocks',blocks:[
    {x:0,y:0,z:0},{x:0,y:1,z:0},{x:1,y:0,z:0},{x:1,y:1,z:0},
    {x:0,y:0,z:1},{x:1,y:0,z:1},{x:1,y:1,z:1},{x:2,y:0,z:1},{x:1,y:0,z:2},
  ]};
  const answer = submission ?? (problem.code==='L6-02'?l6Witness:problem.answer);
  const prior = (await db.query<{wrong_count:number;hint_shown:boolean;answer_revealed:boolean;completed:boolean;attempt_count:number}>('select * from sb_problem_attempts where student_id=$1 and problem_id=$2',[studentId,problemId])).rows[0];
  const verdict = grade({problemType:problem.problem_type,gradingMode:problem.grading_mode,answer:problem.answer,submission:answer,given:problem.given,grid:{gridWidth:problem.grid_width,gridDepth:problem.grid_depth,maxHeight:problem.max_height}});
  const outcome = applyAttempt(prior?{wrongCount:prior.wrong_count,hintShown:prior.hint_shown,answerRevealed:prior.answer_revealed,completed:prior.completed}:INITIAL_ATTEMPT,verdict.correct,['FREE_BUILD','BUILD_FROM_VIEWS','BUILD_FROM_HEIGHTMAP','BUILD_FROM_LAYERS'].includes(problem.problem_type));
  await db.query('select sb_record_attempt($1,$2,$3,$4,$5)',[studentId,problemId,prior?.attempt_count??0,{...outcome.state,stars:outcome.stars,xp:outcome.xpEarned},answer.kind==='blocks'?answer.blocks:null]);
  return {verdict,outcome};
}

export async function solveRequiredLesson(db: Db, studentId: string, lesson: number) {
  const problems = (await db.query<ProblemRow>(`select p.* from sb_problems p join sb_students s on s.id=$1 where p.active and p.lesson=$2 and (p.class_id is null or p.class_id=s.class_id) order by p.order_index,p.id`,[studentId,lesson])).rows;
  // This is parseProblemRow's persisted stage contract, passed to the actual shared selector.
  const required = requiredSolveIds(problems.map(p=>({id:p.id,stage:p.order_index<=1?'concept':p.order_index===2?'check':'more'})));
  assert.ok(required.length>0,`lesson ${lesson} has actual required seed work`);
  for(const id of required) assert.equal((await submitProblem(db,studentId,id)).verdict.correct,true,`seed answer ${id} is independently graded`);
  return required;
}

export async function completeActivityLessons(db: Db, studentId: string) {
  const classId=(await db.query<{class_id:string}>('select class_id from sb_students where id=$1',[studentId])).rows[0].class_id;
  const challenge=(await db.query<{id:string}>(`insert into sb_shared_challenges(class_id,author_id,share_code,source) values($1,null,$2,'system') returning id`,[classId,`QA${studentId.slice(-8)}`])).rows[0].id;
  await db.query('select sb_submit_challenge_v2($1,$2,0,$3)',[studentId,challenge,{completed:true,hintShown:false,wrongCount:0,answerRevealed:false,expectedHintShown:false}]);
  const building={building_name:'합성 수학관',reason:'층별로 비교하기',description:'세 층 소개',layer_notes:['1층','2층','3층'],blocks:[{x:0,y:0,z:0},{x:0,y:1,z:0},{x:0,y:2,z:0}],grid_width:10,grid_depth:10,max_height:3,submitted:true};
  await db.query('select sb_save_building($1,$2,0,$3)',[studentId,classId,building]);
}

export async function readTeacherSummary(db: Db, classId=CLASS) {
  const students=(await db.query<{id:string;name:string;student_no:number}>('select id,name,student_no from sb_students where class_id=$1 order by student_no',[classId])).rows;
  const ids=students.map(s=>s.id);
  const progress=(await db.query<ProgressSourceRow & {student_id:string}>('select student_id,lesson,completed,updated_at from sb_student_progress where student_id=any($1::uuid[])',[ids])).rows;
  const attempts=(await db.query<AttemptSourceRow & {student_id:string}>(`select a.student_id,a.problem_id,a.lesson,a.wrong_count,a.completed,a.updated_at,p.order_index from sb_problem_attempts a join sb_problems p on p.id=a.problem_id where a.student_id=any($1::uuid[])`,[ids])).rows;
  const problems=(await db.query<{id:string;lesson:number;order_index:number}>('select id,lesson,order_index from sb_problems where active and (class_id is null or class_id=$1)',[classId])).rows;
  return students.map(s=>summarizeStudentProgress(s.id,s.name,s.student_no,progress.filter(p=>p.student_id===s.id),attempts.filter(a=>a.student_id===s.id),problems));
}
