import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { generatedProblemId } from '../shared/practiceSet.ts';

test('PostgreSQL migrations, RLS isolation and atomic progression', async () => {
  const db = new PGlite();
  try {
    // Supabase Auth surface only is emulated. Actual SQL and RLS execute in PostgreSQL.
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth,public to anon,authenticated,service_role;
      grant execute on function auth.uid() to anon,authenticated,service_role;`);
    await db.exec(`create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;`);
    for (const file of readdirSync('supabase/migrations').sort()) {
      // PGlite supplies gen_random_uuid natively; pgcrypto is a Supabase extension.
      await db.exec(readFileSync('supabase/migrations/'+file,'utf8').replace('create extension if not exists "pgcrypto";', ''));
    }
    // 기존 nullable 복합 unique는 전역 생성 문항 중복을 막지 않는다.
    for(let i=0;i<2;i++) await db.query("insert into sb_problems(code,lesson,problem_type,title,answer) values('QA-LEGACY-DUP',5,'COUNT','QA', $1)",[{kind:'count',value:1}]);
    assert.equal((await db.query("select id from sb_problems where code='QA-LEGACY-DUP'")).rows.length,2);
    const generatedId=await generatedProblemId('GEN-L5-S123-01-V2');
    for(let i=0;i<2;i++) await db.query("insert into sb_problems(id,code,lesson,problem_type,title,answer) values($1,'QA-V2',5,'COUNT','QA',$2) on conflict(id) do nothing",[generatedId,{kind:'count',value:1}]);
    assert.equal((await db.query("select id from sb_problems where code='QA-V2'")).rows.length,1);
    await Promise.all(Array.from({length:8},()=>db.query("insert into sb_problems(id,code,lesson,problem_type,title,answer) values($1,'QA-V2',5,'COUNT','QA',$2) on conflict(id) do nothing",[generatedId,{kind:'count',value:99}])));
    assert.equal((await db.query<{answer:{value:number}}>("select answer from sb_problems where id=$1",[generatedId])).rows[0].answer.value,1,'중복 요청은 기존 내용을 덮지 않는다');
    assert.notEqual(generatedId,await generatedProblemId('GEN-L5-S123-01-V3'));
    const teacherA='11111111-1111-4111-8111-111111111111', teacherB='22222222-2222-4222-8222-222222222222';
    const classA='33333333-3333-4333-8333-333333333333',classB='44444444-4444-4444-8444-444444444444';
    const student='55555555-5555-4555-8555-555555555555';
    await db.exec(`insert into auth.users values('${teacherA}'),('${teacherB}');
      insert into sb_classes(id,teacher_id,name,class_code) values('${classA}','${teacherA}','A','AAAA'),('${classB}','${teacherB}','B','BBBB');
      insert into sb_students(id,class_id,name,pin_hash) values('${student}','${classA}','학생','hashed');
      insert into sb_student_pin_vault(student_id,class_id,pin_plain) values('${student}','${classA}','7391');`);
    // Live lesson 9: actual PostgreSQL first-completion score and isolation.
    const challenge='66666666-6666-4666-8666-666666666666';
    await db.query("insert into sb_shared_challenges(id,class_id,author_id,share_code,source) values($1,$2,null,'SYSTEMQA','system')",[challenge,classA]);
    await db.query('insert into sb_lesson_settings(class_id,lesson,locked) values($1,9,false)',[classA]);
    const finish={completed:true,hintShown:false,wrongCount:0,answerRevealed:false,expectedHintShown:false,score:999};
    const done=await db.query<{result:{state:{score:number};awarded:boolean}}>('select sb_submit_challenge_v2($1,$2,0,$3) as result',[student,challenge,finish]);
    assert.equal(done.rows[0].result.state.score,2,'first correct insert stores 2, never client 999');
    const repeats=await Promise.all([1,2].map(()=>db.query<{result:{awarded:boolean}}>('select sb_submit_challenge_v2($1,$2,0,$3) as result',[student,challenge,finish])));
    assert.ok(repeats.every(r=>r.rows[0].result.awarded===false));
    assert.equal((await db.query('select * from sb_challenge_solves where challenge_id=$1',[challenge])).rows.length,1);
    await db.query("insert into sb_shared_challenges(class_id,author_id,share_code,source) values($1,null,'OTHERQA','system')",[classB]);
    const other=(await db.query<{id:string}>("select id from sb_shared_challenges where share_code='OTHERQA'")).rows[0].id;
    await assert.rejects(()=>db.query('select sb_submit_challenge_v2($1,$2,0,$3)',[student,other,finish]),/FORBIDDEN/);
    const own=(await db.query<{id:string}>("insert into sb_shared_challenges(class_id,author_id,share_code) values($1,$2,'OWNQA') returning id",[classA,student])).rows[0].id;
    await assert.rejects(()=>db.query('select sb_submit_challenge_v2($1,$2,0,$3)',[student,own,finish]),/FORBIDDEN/);
    const hinted=(await db.query<{id:string}>("insert into sb_shared_challenges(class_id,author_id,share_code,source) values($1,null,'HINTQA','system') returning id",[classA])).rows[0].id;
    await db.query('select sb_submit_challenge_v2($1,$2,0,$3)',[student,hinted,{...finish,completed:false,hintShown:true}]);
    await assert.rejects(()=>db.query('select sb_submit_challenge_v2($1,$2,0,$3)',[student,hinted,finish]),/VERSION_CONFLICT/);
    const hintDone=await db.query<{result:{state:{score:number}}}>('select sb_submit_challenge_v2($1,$2,0,$3) as result',[student,hinted,{...finish,hintShown:true,expectedHintShown:true}]);
    assert.equal(hintDone.rows[0].result.state.score,1);
    await db.query('insert into sb_student_progress(student_id,lesson,practice_seed) values($1,5,123)',[student]);
    const switches=await Promise.all(Array.from({length:2},()=>db.query('update sb_student_progress set practice_seed=8042 where student_id=$1 and lesson=5 and practice_seed=123 returning practice_seed',[student])));
    assert.equal(switches.reduce((n,result)=>n+result.rows.length,0),1,'동일 expectedSeed 전환은 한 번만 실행된다');
    assert.equal((await db.query('update sb_student_progress set practice_seed=15961 where student_id=$1 and lesson=5 and practice_seed=123 returning practice_seed',[student])).rows.length,0,'응답 유실 재전송은 다음다음 세트를 만들지 않는다');
    // 이후 기존 진도 검사는 1차시만 대상으로 한다.
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${teacherB}';`);
    assert.equal((await db.query('select * from sb_student_pin_vault')).rows.length,0);
    assert.equal((await db.query('select * from sb_students')).rows.length,0);
    assert.equal((await db.query('select * from sb_classes')).rows.length,1);
    await db.exec(`set request.jwt.claim.sub='${teacherA}';`);
    assert.equal((await db.query('select * from sb_student_pin_vault')).rows.length,1);
    await db.exec('reset role; set role anon;');
    for(const table of ['sb_students','sb_student_pin_vault','sb_problems','sb_student_progress','sb_student_sessions','sb_teacher_settings']) await assert.rejects(()=>db.query(`select * from ${table}`), /permission denied/,table);
    await assert.rejects(()=>db.query('select sb_record_attempt($1,$2,0,$3,null)',[student,student,{}]), /permission denied/);
    await db.exec('reset role;');
    const {rows:problems}=await db.query<{id:string}>('select id from sb_problems where lesson=1 order by order_index');
    assert.ok(problems.length>1);
    const completed={wrongCount:0,hintShown:false,answerRevealed:false,completed:true,stars:3,xp:30};
    await db.query('select sb_record_attempt($1,$2,0,$3,null)',[student,problems[0].id,completed]);
    assert.equal((await db.query<{completed:boolean}>('select completed from sb_student_progress where lesson=1')).rows[0].completed,false,'one problem does not complete the lesson');
    await assert.rejects(()=>db.query('select sb_record_attempt($1,$2,0,$3,null)',[student,problems[0].id,completed]),/ATTEMPT_CONFLICT/);
    assert.equal((await db.query<{total_xp:number}>('select total_xp from sb_student_rewards')).rows[0].total_xp,30);
    for (const p of problems.slice(1)) await db.query('select sb_record_attempt($1,$2,0,$3,null)',[student,p.id,completed]);
    assert.equal((await db.query<{completed:boolean}>('select completed from sb_student_progress where lesson=1')).rows[0].completed,true);
    await db.query('insert into sb_lesson_settings(class_id,lesson,locked) values($1,1,true)',[classA]);
    await assert.rejects(()=>db.query('select sb_record_attempt($1,$2,1,$3,null)',[student,problems[0].id,completed]),/LESSON_LOCKED/);
  } finally { await db.close(); }
});
