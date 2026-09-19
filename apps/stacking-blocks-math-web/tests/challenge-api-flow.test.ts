import {test} from 'node:test';
import assert from 'node:assert/strict';
import {liveApi,SYNTHETIC_PIN,STUDENTS,CLASS} from '../e2e/support/live-api.ts';
import {generatePeerPracticeBank} from '../shared/peerPracticeBank.ts';
import {challengeCorrect,type ChallengeRow} from '../supabase/functions/_shared/challenge-bank.ts';
import {PEER_GRID} from '../shared/phase4.ts';
import {solveViewConstraint} from '../oracle/dfs.ts';

test('actual activity handler: safe fallback, peer priority, scopes, scoring, replay and hints',async()=>{
 const api=await liveApi();try{
 const tokens=[];for(const name of ['QA학생1','QA학생2','QA학생3']){const r=await api.request('student-auth',{action:'login',classCode:'QAONLY',name,pin:SYNTHETIC_PIN},undefined);tokens.push((await r.json()).token as string);}
 const call=(i:number,action:string,data:Record<string,unknown>={})=>api.request('student-api',{action:`activity:challenge:${action}`,...data},tokens[i]);
 assert.equal((await api.request('student-api',{action:'activity:challenge:list'},undefined)).status,401);
 const list=await (await call(0,'list')).json();assert.equal(list.challenges.length,24);
 assert.deepEqual(Object.keys(list.challenges[0]).sort(),['code','completed','given','source','title']);
 assert.equal(JSON.stringify(list).includes('hidden_validation'),false);assert.equal(JSON.stringify(list).includes('blocks'),false);assert.equal(JSON.stringify(list).includes('answer'),false);
 const code=list.challenges[0].code,blocks=generatePeerPracticeBank()[0].blocks;
 const get=await (await call(0,'get',{code})).json();assert.equal('answer'in get,false);assert.equal('hintGiven'in get,false);
 const done=await (await call(0,'attempt',{code,blocks,score:999,is_correct:false})).json();assert.equal(done.state.score,2);
 const replay=await (await call(0,'attempt',{code,blocks:[]})).json();assert.equal(replay.state.score,2);assert.equal(replay.outcome.xpEarned,0);
 const lateHint=await (await call(0,'hint',{code})).json();assert.equal(lateHint.state.score,2);assert.equal(lateHint.state.hintShown,false);
 const refreshed=await (await call(0,'list')).json();assert.notEqual(refreshed.challenges[0].code,code);assert.equal(refreshed.challenges.at(-1).code,code);
 assert.equal((await api.pg.query('select * from sb_shared_challenges')).rows.length,24);
 await call(1,'hint',{code});const hinted=await (await call(1,'attempt',{code,blocks})).json();assert.equal(hinted.state.score,1);
 const pristine=await (await call(2,'get',{code})).json();assert.equal(pristine.state.completed,false);assert.equal(pristine.state.hintShown,false);
 for(let i=0;i<3;i++){const created=await (await call(0,'create',{blocks:generatePeerPracticeBank()[i].blocks,type:'views',hintType:'layers'})).json();assert.ok(created.code);assert.equal((await call(0,'attempt',{code:created.code,blocks})).status,403);}
 const peers=await (await call(2,'list')).json();assert.equal(peers.challenges.length,3);assert.ok(peers.challenges.every((c:{source:string})=>c.source==='student'));
 await api.pg.exec(`insert into sb_classes(id,teacher_id,name,class_code) values('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','other','OTHER');insert into sb_shared_challenges(class_id,source,share_code) values('44444444-4444-4444-8444-444444444444','system','OTHERCLASS');`);
 assert.equal((await call(2,'get',{code:'OTHERCLASS',classId:'44444444-4444-4444-8444-444444444444'})).status,404);
 assert.equal((await api.pg.query('select * from sb_challenge_solves where student_id=$1',[STUDENTS[2]])).rows.length,0);
 await api.pg.query('update sb_lesson_settings set locked=true where class_id=$1 and lesson=9',[CLASS]);assert.equal((await call(0,'list')).status,403);
 }finally{await api.close();}
});

test('non-original valid model is accepted until a conflicting full hint is revealed',()=>{
 for(const p of generatePeerPracticeBank()){
  const solved=solveViewConstraint(p.card.projections!,PEER_GRID,{exactCount:10,solutionCap:Number.MAX_SAFE_INTEGER});
  const c={blocks:p.blocks,challenge_type:'views',hint_type:'heightMap'} as ChallengeRow;
  const alternative=solved.sampleSolutions.find(b=>challengeCorrect(c,b,false)&&!challengeCorrect(c,b,true));
  if(alternative){assert.equal(challengeCorrect(c,alternative,false),true);assert.equal(challengeCorrect(c,alternative,true),false);return;}
 }
 assert.fail('test needs a genuine multiple-solution witness');
});
