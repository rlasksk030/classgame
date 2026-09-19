import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {liveApi,SYNTHETIC_PIN} from '../e2e/support/live-api.ts';
import {EMPTY_BUILDING} from '../shared/activities.ts';
import {generatePeerPracticeBank} from '../shared/peerPracticeBank.ts';

// Controlled local PostgreSQL/WASM test, NOT a remote throughput benchmark.
// Authentication is synthetic; activity handlers and database transactions are real.
test('30 concurrent students: progress, score, projects and class isolation', {timeout:60000}, async()=>{
 const classes=[randomUUID(),randomUUID()];
 const students=Array.from({length:30},(_,i)=>({id:randomUUID(),classId:classes[i%2],classCode:`QA${i%2}`,name:`합성학생${i}`}));
 const api=await liveApi({students});
 try{
  const tokens=await Promise.all(students.map(async s=>{
   const r=await api.request('student-auth',{action:'login',classCode:s.classCode,name:s.name,pin:SYNTHETIC_PIN},undefined);
   assert.equal(r.status,200);return (await r.json()).token as string;
  }));
  assert.equal(new Set(tokens).size,30);
  const call=(i:number,action:string,body:Record<string,unknown>={})=>api.request('student-api',{action:`activity:${action}`,...body},tokens[i]);
  const problem=randomUUID();
  await api.pg.query("insert into sb_problems(id,lesson,problem_type,title,answer) values($1,12,'COUNT','합성 동시 저장','{}')",[problem]);
  const next={wrongCount:0,hintShown:false,answerRevealed:false,completed:true,stars:3,xp:30};
  const progress=await Promise.allSettled(students.flatMap(s=>[0,1].map(()=>api.pg.query('select sb_record_attempt($1,$2,0,$3,null)',[s.id,problem,next]))));
  assert.equal(progress.filter(r=>r.status==='fulfilled').length,30,String(progress.find(r=>r.status==='rejected')?.reason));
  for(const r of progress)if(r.status==='rejected')assert.match(String(r.reason),/ATTEMPT_CONFLICT/);
  // One problem is complete; the seeded lesson still has other problems.
  assert.equal((await api.pg.query('select * from sb_student_progress where last_problem_id=$1',[problem])).rows.length,30);
  assert.equal((await api.pg.query('select * from sb_problem_attempts where problem_id=$1 and completed',[problem])).rows.length,30);
  assert.equal((await api.pg.query('select * from sb_student_rewards where total_xp=30')).rows.length,30);

  const lists=await Promise.all(students.map(async(_,i)=>{
   const r=await call(i,'challenge:list');assert.equal(r.status,200);return (await r.json()).challenges;
  }));
  assert.ok(lists.every(l=>l.length===24));
  assert.equal((await api.pg.query('select * from sb_shared_challenges')).rows.length,48);
  assert.equal((await api.pg.query('select class_id,share_code,count(*) from sb_shared_challenges group by 1,2 having count(*)>1')).rows.length,0);
  const forbidden=new Set(['answer','hidden_validation_json','blocks','revealedAnswer','hintGiven','author_id','validation','solution']);
  const inspect=(v:unknown)=>{if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){assert.ok(!forbidden.has(k),`private field ${k}`);inspect(x);}};
  inspect(lists);
  assert.equal((await call(1,'challenge:get',{code:lists[0][0].code})).status,404);
  const blocks=generatePeerPracticeBank()[0].blocks;
  const created=await (await call(0,'challenge:create',{blocks,type:'views',hintType:'heightMap'})).json();
  const peer=await call(2,'challenge:get',{code:created.code});assert.equal(peer.status,200);inspect(await peer.json());
  inspect(await (await call(0,'challenge:get',{code:lists[0][0].code})).json());
  assert.equal((await call(1,'challenge:get',{code:created.code})).status,404);
  const scores=await Promise.all(students.flatMap((_,i)=>[0,1].map(()=>call(i,'challenge:attempt',{code:lists[i][0].code,blocks}))));
  assert.ok(scores.every(r=>[200,409].includes(r.status)));
  const rows=await api.pg.query<{student_id:string;score:number}>('select student_id,score from sb_challenge_solves');
  assert.equal(rows.rows.length,30);assert.equal(new Set(rows.rows.map(r=>r.student_id)).size,30);assert.ok(rows.rows.every(r=>r.score===2));

  const saves=await Promise.all(students.flatMap((_,i)=>[0,1].map(()=>call(i,'project:save',{building:{...EMPTY_BUILDING,building_name:`작품${i}`,reason:'합성 QA',blocks:[{x:i%10,y:0,z:0}]}}))));
  assert.equal(saves.filter(r=>r.status===200).length,30);assert.equal(saves.filter(r=>r.status===409).length,30);
  await Promise.all(students.map(async(s,i)=>{
   const r=await call(i,'project:get',{lesson:11,studentId:students[(i+1)%30].id,classId:students[(i+1)%30].classId});
   const b=(await r.json()).building;assert.equal(b.building_name,`작품${i}`);assert.deepEqual(b.blocks,[{x:i%10,y:0,z:0}]);
   assert.equal((await call(i,'review:save',{confidence:2,reflection:`학생${i}`})).status,200);
   const login=await api.request('student-auth',{action:'login',classCode:s.classCode,name:s.name,pin:SYNTHETIC_PIN},undefined);
   const again=await api.request('student-api',{action:'activity:review:get',studentId:students[(i+1)%30].id},(await login.json()).token);
   assert.equal((await again.json()).evaluation.reflection,`학생${i}`);
  }));
  assert.equal((await api.pg.query('select * from sb_projects')).rows.length,30);
 }finally{await api.close();}
});
