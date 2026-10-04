import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { CLASS, OTHER_CLASS, STUDENTS, OTHER_STUDENT, REQUIRED_LESSONS, setupRequiredProgressDb, solveRequiredLesson, submitProblem, completeActivityLessons, readTeacherSummary } from './support/required-progress-db.ts';

// No progress completion flags are injected. Student submissions run the real
// grader + attempt state machine + sb_record_attempt; teacher reads persisted rows.
test('required work persists as teacher 0/12 -> 1/12 -> 3/12 -> 12/12, including actual activity RPC completion',async()=>{
  const db=await setupRequiredProgressDb();
  try {
    assert.equal((await readTeacherSummary(db))[0].requiredProgress.completedLessons,0);
    for(const lesson of [1,2,3]) {
      await solveRequiredLesson(db,STUDENTS[0],lesson);
      assert.equal((await db.query<{completed:boolean}>('select completed from sb_student_progress where student_id=$1 and lesson=$2',[STUDENTS[0],lesson])).rows[0].completed,true,'RPC persists completion; read-time aggregation cannot mask a failed write');
      const summary=(await readTeacherSummary(db))[0];
      assert.equal(summary.requiredProgress.completedLessons,lesson,`actual required submissions must produce ${lesson}/12 without optional work`);
      assert.equal(summary.requiredProgress.totalLessons,12);
      assert.equal(summary.lessonStates[lesson-1],'complete');
    }
    for(const lesson of [4,5,6,7,8,12]) await solveRequiredLesson(db,STUDENTS[0],lesson);
    assert.equal((await readTeacherSummary(db))[0].requiredProgress.completedLessons,9);
    await completeActivityLessons(db,STUDENTS[0]);
    const complete=(await readTeacherSummary(db))[0];
    assert.equal(complete.requiredProgress.completedLessons,12);
    assert.deepEqual(complete.lessonStates,Array(12).fill('complete'));
  } finally {await db.close();}
});

test('concept work, optional duplicates and historical generated seeds cannot complete or obstruct required work',async()=>{
  const db=await setupRequiredProgressDb();
  try {
    const optionalIds:string[]=[];
    for(const [index,code] of ['GEN-L1-S100-01-V2','GEN-L1-S100-01-V2','GEN-L1-S200-01-V3'].entries()) {
      const row=(await db.query<{id:string}>(`insert into sb_problems(code,lesson,order_index,problem_type,title,answer) values($1,1,$2,'COUNT','합성 선택 문제',$3) returning id`,[code,100+index,{kind:'count',value:1}])).rows[0];
      optionalIds.push(row.id);
    }
    const concept=(await db.query<{id:string}>('select id from sb_problems where lesson=1 and active and order_index<=1 order by id limit 1')).rows[0].id;
    for(const id of [concept,...optionalIds]) await submitProblem(db,STUDENTS[0],id);
    assert.equal((await readTeacherSummary(db))[0].requiredProgress.completedLessons,0,'optional/concept submissions do not complete a required lesson');
    const required=await solveRequiredLesson(db,STUDENTS[0],1);
    assert.equal((await readTeacherSummary(db))[0].requiredProgress.completedLessons,1,'unattempted built-in optional work does not obstruct required completion');
    await submitProblem(db,STUDENTS[0],required[0]);
    assert.equal((await readTeacherSummary(db))[0].requiredProgress.completedLessons,1,'resubmission does not duplicate a completed lesson');
    assert.equal((await db.query('select * from sb_problem_attempts where student_id=$1 and problem_id=$2',[STUDENTS[0],required[0]])).rows.length,1);
    const newOptional=(await db.query<{id:string}>(`insert into sb_problems(code,lesson,order_index,problem_type,title,answer) values('GEN-L1-S300-01-V3',1,100,'COUNT','다음 선택 세트',$1) returning id`,[{kind:'count',value:2}])).rows[0].id;
    await submitProblem(db,STUDENTS[0],newOptional,{kind:'count',value:0});
    const summary=(await readTeacherSummary(db))[0];
    assert.equal(summary.requiredProgress.completedLessons,1,'later optional wrong attempts cannot regress required completion');
    assert.equal(summary.wrongCount,1);
    assert.equal(summary.currentLesson,1);
    assert.ok(summary.lastActivityAt);
  } finally {await db.close();}
});

test('teacher required progress isolates three students at 1/12, 5/12, 12/12 and excludes another class',async()=>{
  const db=await setupRequiredProgressDb();
  try {
    // Another class's required item must never block this class's required work.
    const otherProblem=(await db.query<{id:string}>(`insert into sb_problems(class_id,code,lesson,order_index,problem_type,title,answer) values($1,'OTHER-CHECK',1,2,'COUNT','다른 반 필수 문제',$2) returning id`,[OTHER_CLASS,{kind:'count',value:1}])).rows[0].id;
    await solveRequiredLesson(db,STUDENTS[0],1);
    for(const lesson of [1,2,3,4,5]) await solveRequiredLesson(db,STUDENTS[1],lesson);
    for(const lesson of REQUIRED_LESSONS) await solveRequiredLesson(db,STUDENTS[2],lesson);
    await completeActivityLessons(db,STUDENTS[2]);
    await solveRequiredLesson(db,OTHER_STUDENT,1);
    const summaries=await readTeacherSummary(db,CLASS);
    assert.deepEqual(summaries.map(s=>[s.studentId,s.requiredProgress.completedLessons]),STUDENTS.map((id,i)=>[id,[1,5,12][i]]));
    assert.equal((await readTeacherSummary(db,OTHER_CLASS))[0].requiredProgress.completedLessons,1);
    await assert.rejects(()=>submitProblem(db,STUDENTS[0],otherProblem));
    assert.deepEqual((await readTeacherSummary(db)).map(s=>s.requiredProgress.completedLessons),[1,5,12]);
  } finally {await db.close();}
});

test('required completion is restored from a reopened PostgreSQL database with no browser or process state',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'teacher-required-progress-'));
  let db=await setupRequiredProgressDb(directory);
  try {
    for(const lesson of [1,2,3]) await solveRequiredLesson(db,STUDENTS[0],lesson);
    const before=await readTeacherSummary(db);
    assert.equal(before[0].requiredProgress.completedLessons,3);
    await db.close();
    db=new PGlite(directory);
    const after=await readTeacherSummary(db);
    assert.deepEqual(after,before,'fresh database connection rebuilds the same teacher view solely from stored rows');
    assert.equal((await db.query<{completed:boolean}>('select completed from sb_student_progress where student_id=$1 and lesson=1',[STUDENTS[0]])).rows[0].completed,true);
  } finally {await db.close();await rm(directory,{recursive:true,force:true});}
});


test('opening guided work or submitting a wrong required answer does not complete; every visible required item is necessary',async()=>{
  const db=await setupRequiredProgressDb();
  try {
    await db.query('insert into sb_student_progress(student_id,lesson,guided_completed) values($1,1,true)',[STUDENTS[0]]);
    assert.equal((await readTeacherSummary(db))[0].requiredProgress.completedLessons,0);
    const original=(await db.query<{id:string}>('select id from sb_problems where lesson=1 and active and order_index=2')).rows[0].id;
    await submitProblem(db,STUDENTS[0],original,{kind:'count',value:0});
    assert.equal((await readTeacherSummary(db))[0].requiredProgress.completedLessons,0);
    const extra=(await db.query<{id:string}>(`insert into sb_problems(class_id,code,lesson,order_index,problem_type,title,answer) values($1,'EXTRA-CHECK',1,2,'COUNT','추가 필수 문항',$2) returning id`,[CLASS,{kind:'count',value:2}])).rows[0].id;
    await submitProblem(db,STUDENTS[0],original);
    assert.equal((await readTeacherSummary(db))[0].requiredProgress.completedLessons,0,'one of two required items is incomplete');
    await submitProblem(db,STUDENTS[0],extra);
    const summary=(await readTeacherSummary(db))[0];
    assert.equal(summary.requiredProgress.completedLessons,1);
    assert.equal(summary.wrongCount,1,'retry preserves the initial wrong answer record');
    assert.equal(summary.optionalPracticeCount,0,'two required items are not miscounted as optional practice');
  } finally {await db.close();}
});

test('generic problem attempts neither grant nor erase challenge/project activity completion',async()=>{
  const db=await setupRequiredProgressDb();
  try {
    const ids:string[]=[];
    for(const lesson of [9,10,11]) {
      const problem=(await db.query<{id:string}>(`insert into sb_problems(class_id,code,lesson,order_index,problem_type,title,answer) values($1,$2,$3,2,'COUNT','활동 차시의 합성 문항',$4) returning id`,[CLASS,`ACTIVITY-CHECK-${lesson}`,lesson,{kind:'count',value:1}])).rows[0].id;
      ids.push(problem);
      await submitProblem(db,STUDENTS[0],problem);
    }
    assert.equal((await readTeacherSummary(db))[0].requiredProgress.completedLessons,0,'activity completion requires its actual activity RPC');
    await completeActivityLessons(db,STUDENTS[0]);
    const before=(await db.query('select lesson,completed,completed_at,stars from sb_student_progress where student_id=$1 and lesson between 9 and 11 order by lesson',[STUDENTS[0]])).rows;
    for(const [index,lesson] of [9,10,11].entries()) {
      const optional=(await db.query<{id:string}>(`insert into sb_problems(class_id,code,lesson,order_index,problem_type,title,answer) values($1,$2,$3,100,'COUNT','활동 뒤 선택 문항',$4) returning id`,[CLASS,`ACTIVITY-MORE-${lesson}`,lesson,{kind:'count',value:1}])).rows[0].id;
      await submitProblem(db,STUDENTS[0],optional,{kind:'count',value:0});
      await submitProblem(db,STUDENTS[0],ids[index]);
    }
    const after=(await db.query('select lesson,completed,completed_at,stars from sb_student_progress where student_id=$1 and lesson between 9 and 11 order by lesson',[STUDENTS[0]])).rows;
    assert.deepEqual(after.map(({stars: _stars,...row})=>row),before.map(({stars: _stars,...row})=>row),'activity completion and timestamps survive generic attempts');
    assert.ok(after.every((row,index)=>Number(row.stars)>=Number(before[index].stars)),'activity stars never decrease');
    assert.equal((await readTeacherSummary(db))[0].requiredProgress.completedLessons,3);
  } finally {await db.close();}
});


test('historical attempts are readable correctly without rewriting old progress and the additive migration preserves records',async()=>{
  const db=await setupRequiredProgressDb(undefined,{legacyCompletion:true});
  try {
    for(const lesson of [1,2,3]) await solveRequiredLesson(db,STUDENTS[0],lesson);
    const before=(await db.query<{lesson:number;completed:boolean;updated_at:Date}>('select lesson,completed,updated_at from sb_student_progress where student_id=$1 order by lesson',[STUDENTS[0]])).rows;
    assert.deepEqual(before.map(row=>row.completed),[false,false,false],'old deployed RPC reproduces the incorrect stored flags');
    const attemptsBefore=(await db.query('select * from sb_problem_attempts where student_id=$1 order by problem_id',[STUDENTS[0]])).rows;
    assert.equal((await readTeacherSummary(db))[0].requiredProgress.completedLessons,3,'existing saved required answers display correctly without requiring a new submission');
    assert.deepEqual((await db.query('select lesson,completed,updated_at from sb_student_progress where student_id=$1 order by lesson',[STUDENTS[0]])).rows,before,'reading teacher summary does not rewrite data');
    const migration=readdirSync('supabase/migrations').find(file=>file.endsWith('_required_lesson_completion.sql'));
    assert.ok(migration,'additive migration exists');
    await db.exec(readFileSync(`supabase/migrations/${migration}`,'utf8'));
    assert.deepEqual((await db.query('select lesson,completed,updated_at from sb_student_progress where student_id=$1 order by lesson',[STUDENTS[0]])).rows,before,'migration does not backfill or alter existing progress');
    assert.deepEqual((await db.query('select * from sb_problem_attempts where student_id=$1 order by problem_id',[STUDENTS[0]])).rows,attemptsBefore,'migration preserves all existing answer records');
    const optional=(await db.query<{id:string}>('select id from sb_problems where lesson=1 and active and order_index>2 order by id limit 1')).rows[0].id;
    await submitProblem(db,STUDENTS[0],optional);
    assert.equal((await db.query<{completed:boolean}>('select completed from sb_student_progress where student_id=$1 and lesson=1',[STUDENTS[0]])).rows[0].completed,true,'future submission persists the corrected required completion');
    assert.equal((await readTeacherSummary(db))[0].requiredProgress.completedLessons,3);
  } finally {await db.close();}
});
