import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CLASS, OTHER_CLASS, TEACHER, STUDENTS, OTHER_STUDENT, setupRequiredProgressDb, solveRequiredLesson, completeActivityLessons, readTeacherSummary, type Db } from './support/required-progress-db.ts';

const migration = () => readFileSync(`supabase/migrations/${readdirSync('supabase/migrations').find(f => f.endsWith('_progress_contract_backfill.sql'))}`, 'utf8');
async function records(db: Db) {
  const result: Record<string, unknown> = {};
  for (const table of ['sb_problem_attempts','sb_student_rewards','sb_block_snapshots','sb_projects','sb_challenge_solves']) {
    result[table] = (await db.query(`select to_jsonb(t) data from ${table} t order by to_jsonb(t)::text`)).rows;
  }
  return result;
}

test('backfill repairs real legacy submissions without changing answers, rewards, snapshots or last activity; replay is idempotent', async () => {
  const db = await setupRequiredProgressDb(undefined, { legacyCompletion: true });
  try {
    for (const lesson of [1,2,3]) await solveRequiredLesson(db, STUDENTS[0], lesson);
    const before = await records(db);
    const timestamps = (await db.query('select lesson,updated_at from sb_student_progress where student_id=$1 order by lesson', [STUDENTS[0]])).rows;
    assert.equal((await db.query('select 1 from sb_student_progress where completed')).rows.length, 0);
    await db.exec(migration());
    assert.equal((await db.query('select 1 from sb_student_progress where student_id=$1 and completed', [STUDENTS[0]])).rows.length, 3);
    assert.deepEqual(await records(db), before);
    assert.deepEqual((await db.query('select lesson,updated_at from sb_student_progress where student_id=$1 order by lesson', [STUDENTS[0]])).rows, timestamps);
    const first = (await db.query('select * from sb_student_progress order by student_id,lesson')).rows;
    await db.exec(migration());
    assert.deepEqual((await db.query('select * from sb_student_progress order by student_id,lesson')).rows, first);
    assert.deepEqual(await records(db), before);
  } finally { await db.close(); }
});

test('activity RPCs record participation without granting completion; 9 and submitted 10/11 keep their existing completion conditions', async () => {
  const db = await setupRequiredProgressDb();
  try {
    const project = { building_name: '초안', reason: '', description: '', layer_notes: ['','',''], blocks: [{x:0,y:0,z:0}], submitted: false, progress_lesson: 10 };
    await db.query('select sb_save_building($1,$2,0,$3)', [STUDENTS[0], CLASS, project]);
    let summary = (await readTeacherSummary(db))[0];
    assert.equal(summary.lessonStates[9], 'in_progress');
    assert.equal(summary.requiredProgress.completedLessons, 0);
    await db.query('select sb_save_building($1,$2,1,$3)', [STUDENTS[0], CLASS, {...project, progress_lesson: 11}]);
    summary = (await readTeacherSummary(db))[0];
    assert.equal(summary.currentLesson, 11);
    assert.equal(summary.lessonStates[10], 'in_progress');
    const c = (await db.query<{id:string}>("insert into sb_shared_challenges(class_id,author_id,share_code,source) values($1,null,'DBTEST','system') returning id", [CLASS])).rows[0].id;
    await db.query('select sb_submit_challenge_v2($1,$2,0,$3)', [STUDENTS[1], c, {completed:false,hintShown:false,wrongCount:1,answerRevealed:false,expectedHintShown:false}]);
    assert.equal((await readTeacherSummary(db))[1].lessonStates[8], 'in_progress');
    await db.query('select sb_submit_challenge_v2($1,$2,1,$3)', [STUDENTS[1], c, {completed:true,hintShown:false,wrongCount:1,answerRevealed:false,expectedHintShown:false}]);
    assert.equal((await readTeacherSummary(db))[1].lessonStates[8], 'complete');
    await completeActivityLessons(db, STUDENTS[2]);
    assert.deepEqual((await readTeacherSummary(db))[2].lessonStates.slice(8,11), ['complete','complete','complete']);
  } finally { await db.close(); }
});

test('class reset RPC rolls back all earlier deletes when reward recomputation fails, then succeeds within its own class', async () => {
  const db = await setupRequiredProgressDb();
  try {
    for (const id of [STUDENTS[0], STUDENTS[1], OTHER_STUDENT]) await solveRequiredLesson(db, id, 1);
    const before = await records(db);
    const progress = (await db.query('select * from sb_student_progress order by student_id,lesson')).rows;
    await db.exec("create function qa_fail_reward() returns trigger language plpgsql as $$ begin raise exception 'QA_RESET_FAILURE'; end $$; create trigger qa_fail_reward before update on sb_student_rewards for each row execute function qa_fail_reward();");
    await assert.rejects(() => db.query('select sb_reset_class_progress($1,$2,null)', [CLASS, TEACHER]), /QA_RESET_FAILURE/);
    assert.deepEqual(await records(db), before);
    assert.deepEqual((await db.query('select * from sb_student_progress order by student_id,lesson')).rows, progress);
    await db.exec('drop trigger qa_fail_reward on sb_student_rewards;');
    const result = await db.query<{count:number}>('select sb_reset_class_progress($1,$2,null) count', [CLASS, TEACHER]);
    assert.equal(result.rows[0].count, 3);
    assert.equal((await readTeacherSummary(db))[0].requiredProgress.completedLessons, 0);
    assert.equal((await readTeacherSummary(db, OTHER_CLASS))[0].requiredProgress.completedLessons, 1);
    await assert.rejects(() => db.query('select sb_reset_class_progress($1,$2,0)', [CLASS, TEACHER]), /BAD_LESSON/);
    await assert.rejects(() => db.query('select sb_reset_class_progress($1,$2,null)', [CLASS, OTHER_STUDENT]), /FORBIDDEN_CLASS/);
    const grants = (await db.query<{anon:boolean;authenticated:boolean;service:boolean}>("select has_function_privilege('anon','sb_reset_class_progress(uuid,uuid,integer)','execute') anon,has_function_privilege('authenticated','sb_reset_class_progress(uuid,uuid,integer)','execute') authenticated,has_function_privilege('service_role','sb_reset_class_progress(uuid,uuid,integer)','execute') service")).rows[0];
    assert.deepEqual(grants, {anon:false,authenticated:false,service:true});
  } finally { await db.close(); }
});

test('activity and lesson 12 historical evidence backfills missing progress; self-evaluation alone grants no completion', async () => {
  const db = await setupRequiredProgressDb();
  try {
    await db.query('insert into sb_self_evaluations(student_id,confidence,reflection) values($1,3,$2)', [STUDENTS[0], '합성 성찰']);
    assert.equal((await readTeacherSummary(db))[0].lessonStates[11], 'not_started');
    await solveRequiredLesson(db, STUDENTS[0], 12);
    assert.equal((await readTeacherSummary(db))[0].lessonStates[11], 'complete');
    await completeActivityLessons(db, STUDENTS[0]);
    await db.query('delete from sb_student_progress where student_id=$1', [STUDENTS[0]]);
    const before = await records(db);
    await db.exec(migration());
    const summary = (await readTeacherSummary(db))[0];
    assert.deepEqual(summary.lessonStates.slice(8), ['complete','complete','complete','complete']);
    assert.deepEqual(await records(db), before);
    assert.equal((await db.query('select reflection from sb_self_evaluations where student_id=$1', [STUDENTS[0]])).rows[0].reflection, '합성 성찰');
    const made = await db.query('insert into sb_shared_challenges(class_id,author_id,share_code) values($1,$2,$3)', [CLASS,STUDENTS[1],'MADEONLY']);
    assert.ok(made);
    const creator = (await readTeacherSummary(db))[1];
    assert.equal(creator.lessonStates[8], 'in_progress');
    assert.equal(creator.requiredProgress.completedLessons, 0, 'making a question is not successful solving');
  } finally { await db.close(); }
});
