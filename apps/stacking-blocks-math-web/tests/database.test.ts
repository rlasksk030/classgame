import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

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
    const teacherA='11111111-1111-4111-8111-111111111111', teacherB='22222222-2222-4222-8222-222222222222';
    const classA='33333333-3333-4333-8333-333333333333',classB='44444444-4444-4444-8444-444444444444';
    const student='55555555-5555-4555-8555-555555555555';
    await db.exec(`insert into auth.users values('${teacherA}'),('${teacherB}');
      insert into sb_classes(id,teacher_id,name,class_code) values('${classA}','${teacherA}','A','AAAA'),('${classB}','${teacherB}','B','BBBB');
      insert into sb_students(id,class_id,name,pin_hash) values('${student}','${classA}','학생','hashed');
      insert into sb_student_pin_vault(student_id,class_id,pin_plain) values('${student}','${classA}','7391');`);
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
    assert.equal((await db.query<{completed:boolean}>('select completed from sb_student_progress')).rows[0].completed,false,'one problem does not complete the lesson');
    await assert.rejects(()=>db.query('select sb_record_attempt($1,$2,0,$3,null)',[student,problems[0].id,completed]),/ATTEMPT_CONFLICT/);
    assert.equal((await db.query<{total_xp:number}>('select total_xp from sb_student_rewards')).rows[0].total_xp,30);
    for (const p of problems.slice(1)) await db.query('select sb_record_attempt($1,$2,0,$3,null)',[student,p.id,completed]);
    assert.equal((await db.query<{completed:boolean}>('select completed from sb_student_progress')).rows[0].completed,true);
    await db.query('insert into sb_lesson_settings(class_id,lesson,locked) values($1,1,true)',[classA]);
    await assert.rejects(()=>db.query('select sb_record_attempt($1,$2,1,$3,null)',[student,problems[0].id,completed]),/LESSON_LOCKED/);
  } finally { await db.close(); }
});
