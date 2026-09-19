import {test} from 'node:test';
import assert from 'node:assert/strict';
import {liveApi,SYNTHETIC_PIN,STUDENTS} from '../e2e/support/live-api.ts';
import {EMPTY_BUILDING} from '../shared/activities.ts';
import {generatePeerPracticeBank} from '../shared/peerPracticeBank.ts';

test('review restore and concurrent project/challenge writes preserve ownership and one completion',async()=>{
 const api=await liveApi();
 try{
  const login=async(name:string)=>(await (await api.request('student-auth',{action:'login',classCode:'QAONLY',name,pin:SYNTHETIC_PIN},undefined)).json()).token as string;
  const a=await login('QA학생1'),b=await login('QA학생2');
  const call=(token:string,action:string,body:Record<string,unknown>={})=>api.request('student-api',{action:`activity:${action}`,...body},token);
  assert.equal((await call(a,'review:save',{confidence:3,reflection:'층별로 비교',studentId:STUDENTS[1]})).status,200);
  const again=await login('QA학생1');
  assert.deepEqual((await (await call(again,'review:get')).json()).evaluation,{confidence:3,reflection:'층별로 비교'});
  assert.equal((await (await call(b,'review:get',{studentId:STUDENTS[0]})).json()).evaluation,null);
  const building={...EMPTY_BUILDING,building_name:'A의 작품',reason:'QA',blocks:[{x:0,y:0,z:0}]};
  const saves=await Promise.all([call(a,'project:save',{building}),call(a,'project:save',{building})]);
  assert.deepEqual(saves.map(r=>r.status).sort(),[200,409]);
  assert.equal((await api.pg.query('select * from sb_projects')).rows.length,1);
  assert.equal((await (await call(b,'project:get',{studentId:STUDENTS[0]})).json()).building,null);
  const restored=(await (await call(again,'project:get',{lesson:11})).json()).building;
  assert.equal(restored.building_name,building.building_name);assert.deepEqual(restored.blocks,building.blocks);
  const list=await (await call(a,'challenge:list')).json();
  const code=list.challenges[0].code,blocks=generatePeerPracticeBank()[0].blocks;
  const attempts=await Promise.all([call(a,'challenge:attempt',{code,blocks}),call(a,'challenge:attempt',{code,blocks})]);
  assert.ok(attempts.every(r=>[200,409].includes(r.status)));assert.ok(attempts.some(r=>r.status===200));
  const rows=await api.pg.query<{score:number}>('select score from sb_challenge_solves where student_id=$1',[STUDENTS[0]]);
  assert.deepEqual(rows.rows.map(r=>r.score),[2]);
  assert.equal((await (await call(b,'challenge:get',{code})).json()).state.completed,false);
 }finally{await api.close();}
});
