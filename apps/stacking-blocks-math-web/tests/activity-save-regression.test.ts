import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_BUILDING, validBuilding } from '../shared/activities.ts';
import { liveApi, CLASS, STUDENTS, SYNTHETIC_PIN } from '../e2e/support/live-api.ts';
const tower = Array.from({length:10},(_,y)=>({x:0,y,z:0}));
const building = {...EMPTY_BUILDING,building_name:'합성 전시관',reason:'층 비교',description:'열 층 전시',blocks:tower,max_height:10,layer_notes:Array.from({length:10},(_,i)=>`${i+1}층\n전시 공간`)};
test('regression: ten-floor designs and one-floor completed brochures are valid',()=>{
 assert.equal(validBuilding(building),true);
 assert.equal(validBuilding({...building,blocks:tower.slice(0,1),layer_notes:['전시관\n전시 공간',...Array(9).fill('')]},true),true);
 assert.equal(validBuilding({...building,blocks:[{x:0,y:10,z:0}]}),false);
});
test('regression: saved design readback includes server time and preserves floor ten',async()=>{
 const api=await liveApi();
 try {
  const auth=await (await api.request('student-auth',{classCode:'QAONLY',name:'QA학생1',pin:SYNTHETIC_PIN},undefined)).json();
  const save=await api.request('student-api',{action:'activity:project:save',lesson:10,building},auth.token);
  assert.equal(save.status,200,await save.text());
  const loaded=await (await api.request('student-api',{action:'activity:project:get',lesson:10},auth.token)).json();
  assert.equal(loaded.building.max_height,10);
  assert.equal(loaded.building.version,1);
  assert.ok(loaded.building.updated_at);
  assert.deepEqual(loaded.building.blocks,tower);
 } finally {await api.close();}
});
test('regression: retrying challenge creation returns one persistent own code',async()=>{
 const api=await liveApi();
 try{
  const auth=await(await api.request('student-auth',{classCode:'QAONLY',name:'QA학생1',pin:SYNTHETIC_PIN},undefined)).json();
  const input={action:'activity:challenge:create',requestId:'11111111-1111-4111-8111-111111111112',blocks:Array.from({length:10},(_,i)=>({x:i%5,y:0,z:Math.floor(i/5)})),type:'views',hintType:'heightMap'};
  const first=await(await api.request('student-api',input,auth.token)).json();
  const second=await(await api.request('student-api',input,auth.token)).json();
  assert.ok(first.code);
  assert.equal(first.code,second.code);
  const mine=await(await api.request('student-api',{action:'activity:challenge:mine'},auth.token)).json();
  assert.equal(mine.challenges[0].code,first.code);
  assert.equal((await api.pg.query('select count(*)::int n from sb_shared_challenges where class_id=$1 and author_id=$2',[CLASS,STUDENTS[0]])).rows[0].n,1);
 }finally{await api.close();}
});
