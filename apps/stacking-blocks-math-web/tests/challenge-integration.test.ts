import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityRequest} from '../supabase/functions/_shared/activities.ts';
import {systemChallengeRows,challengeCard,challengeCorrect} from '../supabase/functions/_shared/challenge-bank.ts';

test('live challenge list is supported and rejects database read errors',async()=>{
 const query={select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{locked:false},error:null}),order(){return this;},limit(){return this;},then(resolve:(v:unknown)=>unknown){return Promise.resolve(resolve({data:null,error:{message:'synthetic failure'}}));}};
 const db={from:()=>query} as unknown as Parameters<typeof activityRequest>[0];
 const result=await activityRequest(db,{action:'activity:challenge:list'},{studentId:'a',classId:'c'});
 assert.equal(result.status,500);
 assert.equal((await result.json()).error.code,'CHALLENGE_LIST_FAILED');
});
test('system bank public cards expose only public material and have class-specific stable ids',async()=>{
 const a=await systemChallengeRows('class-a'),b=await systemChallengeRows('class-b');
 assert.equal(a.length,24);assert.deepEqual(a,await systemChallengeRows('class-a'));
 assert.notEqual(a[0].id,b[0].id);
 const card=challengeCard(a[0],false);
 assert.deepEqual(Object.keys(card).sort(),['code','completed','given','source','title']);
 assert.equal(JSON.stringify(card).includes('blocks'),false);
 assert.equal(challengeCorrect(a[0],a[0].blocks,false),true);
 assert.equal(challengeCorrect(a[0],a[0].blocks,true),true);
 assert.equal(challengeCorrect(a[0],[],false),false);
});
