import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {liveApi,CLASS,STUDENTS,SYNTHETIC_PIN} from '../e2e/support/live-api.ts';
import {emptyLegacyDb,readCatalog,seedProtectedRows} from './support/installer-legacy-db.ts';
import {readMathInstallerPlan} from '../scripts/installer/math-plan.ts';
import {EMPTY_BUILDING} from '../shared/activities.ts';
const input={...EMPTY_BUILDING,building_name:'합성 전시관',reason:'관찰',description:'층 비교',blocks:Array.from({length:10},(_,y)=>({x:0,y,z:0})),layer_notes:Array.from({length:10},(_,i)=>`${i+1}층\n전시`)};
const student=(api:Awaited<ReturnType<typeof liveApi>>,name='QA학생1',classCode='QAONLY')=>api.request('student-auth',{classCode,name,pin:SYNTHETIC_PIN},undefined).then(r=>r.json()).then(r=>r.token as string);
test('10-floor DB contract validates physical structure, retains legacy contents, isolated versions and completion timestamps',async()=>{
 const api=await liveApi();try{
  const token=await student(api),request=(building:unknown,lesson=10)=>api.request('student-api',{action:'activity:project:save',building,lesson},token);
  const old={...input,max_height:3,layer_notes:['기존1','기존2','기존3'],blocks:input.blocks.slice(0,3)};
  assert.equal((await request(old)).status,200);
  const preserved=(await api.pg.query('select blocks,layer_notes,version from sb_projects')).rows[0];assert.deepEqual(preserved.blocks,old.blocks);assert.deepEqual(preserved.layer_notes,old.layer_notes);
  assert.equal((await request({...input,version:1})).status,200);
  assert.equal((await request({...input,version:1})).status,409);
  const broken=await request({...input,version:2,blocks:[{x:0,y:9,z:0}]});assert.equal(broken.status,400);assert.equal((await broken.json()).error.code,'INVALID_BUILDING');
  assert.equal((await request({...input,version:2,submitted:true},11)).status,200);
  const progress=(await api.pg.query('select lesson,completed,completed_at,stars from sb_student_progress where student_id=$1 order by lesson',[STUDENTS[0]])).rows;
  assert.equal(progress.filter(p=>p.completed).length,2);
  await request({...input,version:3,submitted:true},11);
  assert.deepEqual((await api.pg.query('select lesson,completed,completed_at,stars from sb_student_progress where student_id=$1 order by lesson',[STUDENTS[0]])).rows,progress);
  const other=await student(api,'QA학생2');assert.equal((await(await api.request('student-api',{action:'activity:project:get',lesson:11},other)).json()).building,null);
  await api.pg.exec('set role anon');await assert.rejects(()=>api.pg.query('select sb_save_building($1,$2,4,$3)',[STUDENTS[0],CLASS,input]),/permission denied/);await api.pg.exec('reset role');
 }finally{await api.close();}
});
test('completed gallery is same-class only, read-only, revocable and returns no identifiers',async()=>{
 const otherClass='44444444-4444-4444-8444-444444444444';
 const api=await liveApi({students:[{id:STUDENTS[0],classId:CLASS,classCode:'QAONLY',name:'QA학생1'},{id:STUDENTS[1],classId:CLASS,classCode:'QAONLY',name:'QA학생2'},{id:STUDENTS[2],classId:otherClass,classCode:'OTHER',name:'QA학생3'}]});
 try{
  const owner=await student(api),friend=await student(api,'QA학생2'),outsider=await student(api,'QA학생3','OTHER');
  const call=(token:string|undefined,body:Record<string,unknown>)=>api.request('student-api',body,token);
  await call(owner,{action:'activity:project:save',lesson:11,building:{...input,submitted:true}});
  const shared=await(await call(owner,{action:'activity:project:share',lesson:11,version:1,enable:true})).json();assert.match(shared.slug,/^[a-f0-9]{32}$/);
  const body={action:'activity:project:shared',lesson:11,slug:shared.slug};
  const read=await call(friend,body);assert.equal(read.status,200);const dto=await read.json();for(const key of ['student_id','class_id','project_id','share_slug'])assert.equal(key in dto.building,false);
  assert.equal((await call(outsider,body)).status,404);assert.equal((await call(undefined,body)).status,401);
  assert.equal((await call(friend,{action:'activity:project:share',lesson:11,version:1,enable:false,studentId:STUDENTS[0]})).status,404);
  assert.equal((await call(friend,body)).status,200);
  await call(owner,{action:'activity:project:share',lesson:11,version:1,enable:false});assert.equal((await call(friend,body)).status,404);
  const shared2=await(await call(owner,{action:'activity:project:share',lesson:11,version:1,enable:true})).json();assert.notEqual(shared.slug,shared2.slug);
  await call(owner,{action:'activity:project:save',lesson:11,building:{...input,version:1,submitted:false}});
  assert.equal((await call(friend,{...body,slug:shared2.slug})).status,404,'editing revokes the published version');
 }finally{await api.close();}
});
test('challenge code collisions and immutable retry keys are handled without duplicate rows',async()=>{
 const api=await liveApi();try{
  const blocks=Array.from({length:10},(_,i)=>({x:i%5,y:0,z:Math.floor(i/5)}));
  const save=(id:string,code:string,type='views')=>api.pg.query('select sb_create_challenge($1,$2,$3,$4,$5,$6,$7) result',[STUDENTS[0],CLASS,id,code,blocks,type,'heightMap']);
  const a='11111111-1111-4111-8111-111111111111',b='11111111-1111-4111-8111-111111111112';
  const first=(await save(a,'AAAAAA')).rows[0];assert.deepEqual((await save(a,'BBBBBB')).rows[0],first);
  await assert.rejects(()=>save(b,'AAAAAA'),/duplicate key/);await save(b,'CCCCCC');await assert.rejects(()=>save(a,'DDDDDD','top'),/REQUEST_CONFLICT/);
  assert.equal((await api.pg.query('select count(*)::int n from sb_shared_challenges')).rows[0].n,2);
 }finally{await api.close();}
});
test('1000-block payload is accepted and does not lose coordinates or appearance',async()=>{
 const api=await liveApi();try{
  const token=await student(api);const blocks=Array.from({length:1000},(_,i)=>({x:i%10,y:Math.floor(i/100),z:Math.floor(i/10)%10}));
  const building={...input,blocks,block_appearance:Object.fromEntries(blocks.map(b=>[`${b.x},${b.y},${b.z}`,'wood']))};assert.ok(Buffer.byteLength(JSON.stringify(building))<100000);
  const saved=await api.request('student-api',{action:'activity:project:save',lesson:10,building},token);assert.equal(saved.status,200,await saved.text());
  const loaded=await(await api.request('student-api',{action:'activity:project:get',lesson:10},token)).json();assert.deepEqual(loaded.building.blocks,blocks);assert.deepEqual(loaded.building.block_appearance,building.block_appearance);
 }finally{await api.close();}
});
test('additive migration repeat and injected rollback preserve every table row',async()=>{
 const api=await liveApi();try{
  const token=await student(api);await api.request('student-api',{action:'activity:project:save',lesson:10,building:input},token);
  const snapshot=async()=>{const tables=(await api.pg.query<{name:string}>("select tablename name from pg_tables where schemaname='public' order by tablename")).rows;const out:Record<string,unknown>={};for(const t of tables)out[t.name]=(await api.pg.query(`select to_jsonb(t) row from ${t.name} t order by to_jsonb(t)::text`)).rows;return out;};
  const before=await snapshot(),sql=readFileSync('supabase/migrations/20261020012936_activity_save_height_share.sql','utf8');await api.pg.exec(sql);assert.deepEqual(await snapshot(),before);
  await assert.rejects(()=>api.pg.exec(sql.replace('commit;','select 1/0; commit;')),/division by zero/);await api.pg.exec('rollback');assert.deepEqual(await snapshot(),before);
 }finally{await api.close();}
});

test('first application failure rolls back schema and data; success changes no original row fields',async()=>{
 const db=await emptyLegacyDb(),plan=await readMathInstallerPlan(process.cwd());try{
  for(const migration of plan.migrations.slice(0,-1))await db.exec(migration.query.replace('create extension if not exists "pgcrypto";',''));
  await seedProtectedRows(db);
  const catalog=await readCatalog(db),tables=catalog.tables.map(t=>t.name);
  const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async name=>[name,(await db.query(`select to_jsonb(t) row from public."${name}" t order by to_jsonb(t)::text`)).rows.map(r=>r.row)])));
  const before=await snapshot(),sql=plan.migrations.at(-1)!.query;
  await assert.rejects(()=>db.exec(sql.replace('commit;','select 1/0; commit;')),/division by zero/);await db.exec('rollback');
  assert.deepEqual(await readCatalog(db),catalog);assert.deepEqual(await snapshot(),before);
  await db.exec(sql);const after=await snapshot();
  for(const name of tables){assert.equal(after[name].length,before[name].length);for(let i=0;i<before[name].length;i++)for(const [field,value] of Object.entries(before[name][i]))assert.deepEqual(after[name][i][field],value,`${name}.${field}`);}
 }finally{await db.close();}
});
