import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { liveV4Db, liveSchema, compatibilitySql, activityClient } from './support/live-v4-db.ts';
import { activityRequest } from '../supabase/functions/_shared/activities.ts';
import { CLASS, TEACHER, STUDENTS, setupRequiredProgressDb, type Db } from './support/required-progress-db.ts';

const oldProject = {building_name:'Synthetic',reason:'reason',description:'description',layer_notes:['a','b','c'],blocks:[{x:0,y:0,z:0}],submitted:false};
const solved = {wrongCount:0,hintShown:false,answerRevealed:false,completed:true,stars:3,xp:30};
async function seed(db: Db) {
  await db.query('insert into auth.users values($1)',[TEACHER]);
  await db.query("insert into sb_classes(id,teacher_id,name,class_code) values($1,$2,'synthetic','COMPAT')",[CLASS,TEACHER]);
  for (const [i,id] of STUDENTS.entries()) await db.query("insert into sb_students(id,class_id,name,student_no,pin_hash) values($1,$2,'synthetic',$3,'synthetic-hash')",[id,CLASS,i+1]);
  await db.query("insert into sb_student_pin_vault(student_id,class_id,pin_plain) values($1,$2,'0000')",[STUDENTS[0],CLASS]);
  await db.query("insert into sb_student_sessions(student_id,class_id,token_hash,expires_at) values($1,$2,'synthetic-token',now()+interval '1 day')",[STUDENTS[0],CLASS]);
  for (const lesson of [1,9,10,11]) await db.query('insert into sb_lesson_settings(class_id,lesson,locked) values($1,$2,false)',[CLASS,lesson]);
  for (const order of [1,2,3]) await db.query("insert into sb_problems(code,lesson,order_index,problem_type,title,answer) values($1,1,$2,'COUNT','synthetic','{}')",['COMPAT-'+order,order]);
  const problem=(await db.query<{id:string}>('select id from sb_problems where order_index=2')).rows[0].id;
  await db.query('select sb_record_attempt($1,$2,0,$3,null)',[STUDENTS[0],problem,solved]);
  await db.query('select sb_save_building($1,$2,0,$3)',[STUDENTS[0],CLASS,oldProject]);
  // Preserve a historically earned completion even without remaining evidence.
  await db.query('insert into sb_student_progress(student_id,lesson,completed,completed_at) values($1,7,true,now())',[STUDENTS[0]]);
}
async function oldRecords(db: Db) {
  const records: Record<string,unknown> = {};
  for (const table of liveSchema.tables) {
    if (table.name === 'sb_student_progress') continue;
    const columns=liveSchema.columns.filter((c:{table:string})=>c.table===table.name).map((c:{name:string})=>'"'+c.name+'"');
    records[table.name]=(await db.query(`select to_jsonb(t) data from (select ${columns.join(',')} from ${table.name}) t order by to_jsonb(t)::text`)).rows;
  }
  return records;
}

test('live v4 expansion preserves every original column, PIN, session, reward, project, timestamp and earned completion; replay is idempotent', async()=>{
  const db=await liveV4Db();
  try {
    await seed(db);
    assert.equal((await db.query('select completed from sb_student_progress where lesson=1')).rows[0].completed,false);
    const before=await oldRecords(db);
    const activity=(await db.query('select student_id,lesson,updated_at from sb_student_progress order by student_id,lesson')).rows;
    await db.exec(compatibilitySql());
    assert.deepEqual(await oldRecords(db),before);
    const afterActivity=(await db.query<{lesson:number}>('select student_id,lesson,updated_at from sb_student_progress order by student_id,lesson')).rows;
    assert.deepEqual(afterActivity.filter(row=>row.lesson!==10),activity);
    assert.equal((await db.query('select completed from sb_student_progress where lesson=10')).rows[0].completed,false,'old draft is participation only');
    assert.equal((await db.query('select completed from sb_student_progress where lesson=1')).rows[0].completed,true);
    assert.equal((await db.query('select completed from sb_student_progress where lesson=7')).rows[0].completed,true);
    assert.equal((await db.query('select project_id from sb_projects')).rows[0].project_id,null);
    const progress=(await db.query('select * from sb_student_progress order by student_id,lesson')).rows;
    await db.exec(compatibilitySql());
    assert.deepEqual(await oldRecords(db),before);
    assert.deepEqual((await db.query('select * from sb_student_progress order by student_id,lesson')).rows,progress);
  } finally { await db.close(); }
});

test('DB-first: exact legacy RPC names/payloads still work and omitted grid/appearance survive old Edge rollback',async()=>{
  const db=await liveV4Db();
  try {
    await seed(db); await db.exec(compatibilitySql());
    await db.exec('set role service_role');
    await db.query('select sb_save_building($1,$2,1,$3)',[STUDENTS[0],CLASS,oldProject]);
    assert.equal((await db.query('select grid_width from sb_projects')).rows[0].grid_width,5);
    await db.query('select sb_save_building($1,$2,2,$3)',[STUDENTS[0],CLASS,{...oldProject,grid_width:8,grid_depth:8,block_appearance:{'0,0,0':'wood'}}]);
    await db.query('select sb_save_building($1,$2,3,$3)',[STUDENTS[0],CLASS,{...oldProject,submitted:true}]);
    const project=(await db.query('select grid_width,grid_depth,block_appearance from sb_projects')).rows[0];
    assert.deepEqual(project,{grid_width:8,grid_depth:8,block_appearance:{'0,0,0':'wood'}});
    assert.equal((await db.query('select count(*)::int n from sb_student_progress where lesson in(10,11) and completed')).rows[0].n,2);
    await db.query('select sb_save_building($1,$2,0,$3)',[STUDENTS[2],CLASS,oldProject]);
    assert.equal((await db.query('select grid_width from sb_projects where student_id=$1',[STUDENTS[2]])).rows[0].grid_width,5);
    const challenge=(await db.query<{id:string}>("insert into sb_shared_challenges(class_id,author_id,share_code) values($1,$2,'LEGACY') returning id",[CLASS,STUDENTS[1]])).rows[0].id;
    await db.query('select sb_submit_challenge($1,$2,0,$3)',[STUDENTS[0],challenge,solved]);
    assert.equal((await db.query('select completed from sb_student_progress where student_id=$1 and lesson=9',[STUDENTS[0]])).rows[0].completed,true);
    const problem=(await db.query<{id:string}>('select id from sb_problems where order_index=2')).rows[0].id;
    await db.query('select sb_record_attempt($1,$2,0,$3,null)',[STUDENTS[2],problem,solved]);
    assert.equal((await db.query('select completed from sb_student_progress where student_id=$1 and lesson=1',[STUDENTS[2]])).rows[0].completed,true);
  } finally { await db.close(); }
});

test('new Edge prerequisites match a fresh install: columns, constraints, indexes, RLS, policies, triggers, RPC signatures and grants',async()=>{
  const live=await liveV4Db(); const fresh=await setupRequiredProgressDb();
  try {
    await live.exec(compatibilitySql());
    const queries=[
      "select table_name,column_name,udt_name,is_nullable,column_default from information_schema.columns where table_schema='public' and table_name like 'sb_%' order by 1,2",
      "select c.relname,k.conname,pg_get_constraintdef(k.oid) definition from pg_constraint k join pg_class c on c.oid=k.conrelid where c.relnamespace='public'::regnamespace and c.relname like 'sb_%' order by 1,2",
      "select tablename,indexname,indexdef from pg_indexes where schemaname='public' and tablename like 'sb_%' order by 1,2",
      "select relname,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname like 'sb_%' order by 1",
      "select * from pg_policies where schemaname='public' and tablename like 'sb_%' order by tablename,policyname",
      "select c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and c.relname like 'sb_%' and not t.tgisinternal order by 1,2",
    ];
    for(const query of queries) assert.deepEqual((await live.query(query)).rows,(await fresh.query(query)).rows,query);
    const sources=['supabase/functions/student-api/index.ts','supabase/functions/_shared/activities.ts','src/pages/TeacherStudentRecord.tsx'];
    const rpcNames=new Set(sources.flatMap(file=>[...readFileSync(file,'utf8').matchAll(/\.rpc\(\s*['"]([^'"]+)['"]/g)].map(m=>m[1])));
    assert.equal(rpcNames.size,6);
    for(const name of rpcNames) {
      const query="select pg_get_function_identity_arguments(oid) signature, pg_get_function_result(oid) result,prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') authenticated,has_function_privilege('service_role',oid,'execute') service from pg_proc where pronamespace='public'::regnamespace and proname=$1";
      const expected=(await fresh.query(query,[name])).rows;
      assert.equal(expected.length,1,name);
      assert.deepEqual((await live.query(query,[name])).rows,expected,name);
    }
    assert.ok(readdirSync('supabase/migrations').length>=24);
  } finally { await live.close(); await fresh.close(); }
});

test('partial expansion conflict rolls the entire migration back; assignment touch trigger supports actual updates',async()=>{
  const db=await liveV4Db();
  try {
    await seed(db);
    await db.exec('alter table sb_student_progress add column guided_completed text');
    const before=await oldRecords(db);
    await assert.rejects(()=>db.exec(compatibilitySql()),/PREFLIGHT_COLUMN_CONFLICT/);
    await db.exec('rollback');
    assert.deepEqual(await oldRecords(db),before);
    assert.equal((await db.query("select to_regclass('public.sb_practice_assignments') value")).rows[0].value,null);
    await db.exec('alter table sb_student_progress drop column guided_completed');
    await db.exec(compatibilitySql());
    await db.query("insert into sb_practice_assignments(installation_id,class_id,student_id,lesson,curriculum_version,set_id,seed,target_total) values('synthetic',$1,$2,1,'v1','set',1,5)",[CLASS,STUDENTS[0]]);
    await db.exec('update sb_practice_assignments set active=false');
    assert.equal((await db.query('select active from sb_practice_assignments')).rows[0].active,false);
    await db.exec('set role anon');
    await assert.rejects(()=>db.query('select * from sb_practice_assignments'),/permission denied/);
    await assert.rejects(()=>db.query('select sb_submit_challenge_v2($1,$2,0,$3)',[STUDENTS[0],CLASS,{}]),/permission denied/);
  } finally { await db.close(); }
});

test('Edge-second: old frontend payload/answer/hint fields work through current activity handler and expanded live schema',async()=>{
  const db=await liveV4Db();
  try {
    await seed(db); await db.exec(compatibilitySql());
    await db.query("update sb_projects set block_appearance=$1 where student_id=$2",[{'0,0,0':'wood'},STUDENTS[0]]);
    const client=activityClient(db), student={studentId:STUDENTS[0],classId:CLASS};
    const save=await activityRequest(client,{action:'activity:project:save',lesson:10,building:{...oldProject,version:1}},student);
    assert.equal(save.status,200);
    assert.deepEqual((await db.query('select grid_width,block_appearance from sb_projects')).rows[0],{grid_width:5,block_appearance:{'0,0,0':'wood'}});
    const blocks=Array.from({length:10},(_,i)=>({x:i%5,y:0,z:Math.floor(i/5)}));
    await db.query("insert into sb_shared_challenges(class_id,author_id,share_code,blocks) values($1,$2,'OLDCLIENT',$3)",[CLASS,STUDENTS[1],blocks]);
    const get=()=>activityRequest(client,{action:'activity:challenge:get',code:'OLDCLIENT'},student);
    assert.equal((await (await get()).json()).answer,undefined,'never reveal the legacy alias early');
    const hint=await activityRequest(client,{action:'activity:challenge:hint',code:'OLDCLIENT'},student);
    assert.equal(hint.status,200);
    assert.equal((await hint.json()).state.hintShown,true);
    let revealed;
    for(let wrongCount=1;wrongCount<=3;wrongCount++) {
      const wrong=await activityRequest(client,{action:'activity:challenge:attempt',code:'OLDCLIENT',blocks:[]},student);
      assert.equal(wrong.status,200);
      revealed=await wrong.json();
      assert.equal(revealed.state.wrongCount,wrongCount);
      if(wrongCount<3) assert.equal(revealed.answer,undefined);
    }
    assert.deepEqual(revealed.answer,blocks);
    assert.deepEqual(revealed.revealedAnswer,blocks);
    assert.equal(typeof revealed.hint,'string');
    assert.deepEqual((await (await get()).json()).answer,blocks);
    const correct=await activityRequest(client,{action:'activity:challenge:attempt',code:'OLDCLIENT',blocks},student);
    assert.equal(correct.status,200);
    assert.equal((await correct.json()).state.completed,true);
    assert.equal((await db.query('select completed from sb_student_progress where lesson=9 and student_id=$1',[STUDENTS[0]])).rows[0].completed,true);
  } finally { await db.close(); }
});
