import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_PROBLEMS } from '../shared/seedProblems.ts';
import { generatePracticeProblems } from '../shared/practiceGenerator.ts';
import { grade } from '../shared/grading.ts';
import { validateCandidate } from '../oracle/validate.ts';

test('L6-03 and L12 review tasks are no longer copies of earlier tasks', () => {
 for (const [a,b] of [['L6-01','L6-03'],['L2-01','L12-04'],['L7-02','L12-05'],['L8-02','L12-06']]) {
  const signature=(id:string)=>{const p=SEED_PROBLEMS.find(p=>p.code===id)!;return JSON.stringify([p.problemType,p.given,p.givenBlocks,p.answer]);};
  assert.notEqual(signature(a),signature(b),`${a} / ${b}`);
 }
});
test('new L6 generator reaches min/max with numeric answers verified independently', () => {
 const set=generatePracticeProblems(6,6,123,3);
 for(const id of ['lesson6-minimum','lesson6-maximum']) {
  const p=set.find(p=>p.templateId===id)!;
  assert.equal(p.answer.kind,'count');
  assert.match(p.prompt,/최소|최대/);
  assert.equal(validateCandidate(p).ok,true);
  assert.equal(grade({...p,submission:p.answer}).correct,true);
 }
});

import { generateValidatedPracticeSet, taskFingerprint } from '../shared/practiceSet.ts';
import { generatePeerPracticeBank, selectPeerPractice } from '../shared/peerPracticeBank.ts';
import { gradePeer } from '../shared/phase4.ts';
import { solveViewConstraint } from '../oracle/dfs.ts';
import { shuffleChoices } from '../shared/contentBank.ts';

test('v3 accepted sets preserve order, grading, visible uniqueness, and versioned IDs',()=>{
 for(const lesson of [5,6,12])for(const seed of [0,1,42,123,7919,603756])for(const n of [5,20,35]){
  const set=generateValidatedPracticeSet(lesson,n,seed);
  assert.equal(set.length,n);
  assert.equal(new Set(set.map(taskFingerprint)).size,n);
  assert.deepEqual(set,generateValidatedPracticeSet(lesson,n,seed));
  for(const p of set){assert.equal(p.generatorVersion,3);assert.ok(p.code.endsWith('-V3'));assert.equal(validateCandidate(p).ok,true);assert.equal(grade({...p,submission:p.answer}).correct,true);}
 }
});
test('independent complete DFS extrema use all solutions, not just samples',()=>{
 const r=solveViewConstraint({front:[[true],[true],[true]]},{gridWidth:1,gridDepth:2,maxHeight:3},{solutionCap:10000});
 assert.equal(r.capped,false);assert.equal(r.minCount,3);assert.equal(r.maxCount,6);assert.equal(r.solutionCount,7);
 const p=generatePracticeProblems(6,6,123,3)[3];
 assert.equal(validateCandidate({...p,answer:{kind:'count',value:999}}).ok,false);
});
test('choice shuffling is deterministic, unbiased by position, and preserves semantic answer',()=>{
 const original={choices:['정답','오답1','오답2','오답3'],answer:{kind:'choice' as const,index:0}};
 const counts=[0,0,0,0];
 for(let seed=0;seed<2000;seed++){
  const p=shuffleChoices(original,seed);assert.deepEqual(p,shuffleChoices(original,seed));
  assert.equal(p.choices[p.answer.index],'정답');counts[p.answer.index]++;
 }
 assert.ok(counts.every(n=>n>400&&n<600));assert.equal(original.answer.index,0);
});
test('generated peer bank has 24 distinct public tasks, valid hints and a verified solution',()=>{
 const bank=generatePeerPracticeBank();assert.equal(bank.length,24);
 assert.equal(new Set(bank.map(p=>JSON.stringify(p.card))).size,24);
 assert.deepEqual(bank,generatePeerPracticeBank());
 for(const p of bank){assert.equal(p.blocks.length,10);assert.equal(gradePeer(p.blocks,p,false),true);assert.equal(gradePeer(p.blocks,p,true),true);assert.match(p.title,/시스템 연습/);}
 assert.equal(selectPeerPractice([1,2,3],bank).systemPractice.length,0);
 assert.equal(selectPeerPractice([],bank).systemPractice.length,3);
});

test('v3 fingerprint ignores superficial wording, numbering, choice order and hidden models',()=>{
 const p=generatePracticeProblems(5,1,42,3)[0];
 assert.equal(taskFingerprint(p),taskFingerprint({...p,prompt:'문장만 바꿈 99번',seed:9,code:'different',choices:[...p.choices].reverse(),givenBlocks:[{x:0,y:0,z:0}]}));
 const changed=structuredClone(p);changed.given.projections!.front![0][0]=false;
 assert.notEqual(taskFingerprint(p),taskFingerprint(changed));
});
test('oracle rejects missing choice, impossible projections, false uniqueness and false multiplicity',()=>{
 const p=generatePracticeProblems(6,8,123,3);
 assert.equal(validateCandidate({...p[2],choices:[]}).ok,false);
 const broken=structuredClone(p[0]);broken.given.projections!.top=broken.given.projections!.top!.map(row=>row.map(()=>false));
 assert.equal(validateCandidate(broken).ok,false);
 const full={gridWidth:2,gridDepth:2,maxHeight:2},views={top:[[true,true],[true,true]],front:[[true,true],[true,true]],side:[[true,true],[true,true]]};
 const ambiguous={...p[0],grid:full,givenBlocks:[],given:{projections:views},gradingMode:'exact' as const,answer:{kind:'blocks' as const,blocks:[{x:0,y:0,z:0}]}};
 assert.equal(validateCandidate(ambiguous).ok,false);
 const unique={...p[0],grid:{gridWidth:1,gridDepth:1,maxHeight:1},givenBlocks:[],given:{projections:{top:[[true]],front:[[true]],side:[[true]]}},answer:{kind:'blocks' as const,blocks:[{x:0,y:0,z:0}]},prompt:'여러 모양이 가능해요'};
 assert.equal(validateCandidate(unique).ok,false);
});
test('oracle rejects a wrong candidate judgment and mismatched inverse representation',()=>{
 const p=generatePracticeProblems(6,3,123,3)[2];
 assert.equal(p.answer.kind,'choice');
 if(p.answer.kind==='choice')assert.equal(validateCandidate({...p,answer:{kind:'choice',index:1-p.answer.index}}).ok,false);
 const inverse=generatePracticeProblems(12,4,123,3)[3];
 assert.equal(validateCandidate({...inverse,answer:{kind:'heightMap',heightMap:[[0,0],[0,0]]}}).ok,false);
});

test('versioned choice changes never reuse v2 storage identity',async()=>{
 const {generatedProblemId}=await import('../shared/practiceSet.ts');
 const old=generatePracticeProblems(5,5,123,2),next=generatePracticeProblems(5,5,123,3);
 for(let i=0;i<5;i++)assert.notEqual(await generatedProblemId(old[i].code),await generatedProblemId(next[i].code));
 assert.deepEqual(old,generatePracticeProblems(5,5,123,2));
});

test('difficulty follows reasoning and input rather than question order',()=>{
 const p=generatePracticeProblems(6,6,123,3);
 assert.equal(p[3].difficultyTier,'CHALLENGE');
 assert.equal(p[4].difficultyTier,'CHALLENGE');
 assert.equal(generatePracticeProblems(5,2,123,3)[1].difficultyTier,'BASIC');
 const wrongKind={...p[3],answer:{kind:'choice' as const,index:0},choices:['하나']};
 assert.equal(validateCandidate(wrongKind).ok,false);
});
