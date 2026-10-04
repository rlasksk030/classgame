/* global process, console */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createFixture, catalog } from './fixture.mjs';
const dir=process.env.FINAL_PACKAGE_DB+'/';
const pre=readFileSync(dir+'PRECHECK.sql','utf8'),post=readFileSync(dir+'POSTCHECK.sql','utf8'),apply=readFileSync(dir+'APPLY.sql','utf8');
const db=await createFixture(),tests=[];
const T='11111111-1111-4111-8111-111111111111',C='33333333-3333-4333-8333-333333333333';
const S=[1,2,3].map(i=>'55555555-5555-4555-8555-55555555555'+i);
async function check(name,fn){await fn();tests.push({name,status:'PASS'});console.log('PASS',name);}
async function result(sql,key){return (await db.exec(sql)).find(r=>r.rows?.[0]?.[key])?.rows[0][key];}
const fill=b=>post.replace('$precheck$null$precheck$', '$precheck$'+JSON.stringify(b)+'$precheck$');
try{
 await db.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text);');
 for(const m of catalog.migration_history) await db.query('insert into supabase_migrations.schema_migrations values($1,$2)',[m.version,m.name]);
 await db.query('insert into auth.users values($1)',[T]);await db.query("insert into sb_classes(id,teacher_id,name,class_code) values($1,$2,'ZZ_SYNTHETIC_PREPOST','PREPOST')",[C,T]);
 for(const s of S) await db.query("insert into sb_students(id,class_id,name,pin_hash) values($1,$2,'합성','synthetic-hash')",[s,C]);
 const P=(await db.query("insert into sb_problems(lesson,order_index,problem_type,title,answer) values(1,2,'COUNT','합성',$1),(1,3,'COUNT','합성',$1) returning id",[{kind:'count',value:1}])).rows;
 await db.query('insert into sb_lesson_settings(class_id,lesson,locked) values($1,1,false)',[C]);
 for(const s of S) await db.query('select sb_record_attempt($1,$2,0,$3,null)',[s,P[0].id,{wrongCount:0,hintShown:false,answerRevealed:false,completed:true,stars:1,xp:10}]);
 await db.query('update sb_student_progress set completed=true,completed_at=null where student_id=$1',[S[1]]);
 await db.query('delete from sb_student_progress where student_id=$1',[S[2]]);
 const baseline=await result(pre,'precheck');
 await check('PRECHECK read-only/catalog/history/22-table aggregate',async()=>{assert.equal(baseline.read_only,'on');assert.equal(baseline.catalog_pass,true,JSON.stringify(baseline.catalog_checks.filter(x=>!x.pass)));assert.equal(baseline.history_pass,true);assert.equal(Object.keys(baseline.counts).length,22);assert.equal(baseline.backfill.required_inserts,1);assert.equal(baseline.backfill.required_false_to_true,1);assert.equal(baseline.backfill.required_timestamp_repairs,1);assert.equal(baseline.backfill.total_changed_rows,3);});
 await db.exec(apply);
 await check('POSTCHECK expected inserts/promotions/repairs and row preservation',async()=>{const r=await result(fill(baseline),'postcheck');for(const k of['baseline_present','catalog_pass','history_pass','all_preservation_checks_pass','backfill_remaining_zero','completed_total_pass']) assert.equal(r[k],true,k+': '+JSON.stringify(r));});
 await check('POSTCHECK missing baseline cannot PASS',async()=>{const r=await result(post,'postcheck');assert.equal(r.baseline_present,false);assert.equal(r.all_preservation_checks_pass,false);assert.equal(r.completed_total_pass,false);});
 await check('APPLY second execution retains catalog/data counts',async()=>{await db.exec(apply);const r=await result(fill(baseline),'postcheck');assert.equal(r.catalog_pass,true);assert.equal(r.all_preservation_checks_pass,true);assert.equal(r.completed_total_pass,true);assert.equal(r.backfill_remaining_zero,true);});
 await check('POSTCHECK row loss is detected',async()=>{await db.query('delete from sb_problem_attempts where student_id=$1',[S[0]]);const r=await result(fill(baseline),'postcheck');assert.equal(r.all_preservation_checks_pass,false);assert.equal(r.row_count_checks.find(c=>c.name==='sb_problem_attempts').pass,false);});
 await check('PRECHECK schema/RLS drift cannot PASS',async()=>{await db.exec('alter table sb_classes disable row level security');const r=await result(pre,'precheck');assert.equal(r.catalog_pass,false);assert.equal(r.catalog_checks.find(c=>c.key==='tables').pass,false);});
}finally{writeFileSync('evidence/final-check-tests.json',JSON.stringify({scope:'LOCAL SYNTHETIC ONLY',tests},null,2));await db.close();}
