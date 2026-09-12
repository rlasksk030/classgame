import test from 'node:test';
import assert from 'node:assert/strict';
import { countEvidence,COUNT_MODEL,DIRECTION_MODEL,fourDistinctViews,phase2Common,phase2Practice,phase2Adaptive } from '../shared/problems/templates/phase2.ts';
import { gradeSpatial,answerForComparison,initialAttempt } from '../shared/problems/grading/spatial.ts';
import { phase2Definitions,explorationCompleted } from '../shared/curriculum/phase2.ts';
import { initialLesson,phase2Activity,phase2EnsureAdaptive,phase2Restore } from '../shared/progress/phase2.ts';
import { project } from '../shared/blocks.ts';
import { PHASE2_GRID } from '../shared/problems/templates/phase2.ts';
test('lesson 4 independently fixed heights/layer counts and 10 cubes',()=>{
 const c=countEvidence(COUNT_MODEL);assert.equal(COUNT_MODEL.length,10);assert.deepEqual(c.heights,[[2,1,0],[1,3,0],[0,1,2]]);assert.deepEqual(c.layerCounts,[6,3,1]);assert.equal(c.heightSum,10);
 assert.throws(()=>countEvidence([{x:0,y:1,z:0}]));
});
test('four horizontal directions are distinguishable; fixed front/right expectations',()=>{assert.ok(fourDistinctViews(DIRECTION_MODEL));const p=project(DIRECTION_MODEL,PHASE2_GRID);assert.deepEqual(p.front,[[true,true,true],[false,true,true],[false,false,true]]);assert.deepEqual(p.side,[[true,true,true],[true,false,false],[true,false,false]]);});
test('phase2 all generated contracts admit their answer and reject wrong answer across boundary seeds',()=>{for(const id of [1,2,4] as const)for(const seed of [0,1,2,123,314159,2147483647,4294967295]){
 const ps=[...phase2Common(id,seed),...phase2Practice(id,seed),...phase2Adaptive(id,seed,{})];assert.equal(phase2Common(id,seed).length,6);assert.equal(phase2Practice(id,seed).length,5);assert.equal(phase2Adaptive(id,seed,{}).length,id===1?2:3);
 for(const p of ps){assert.equal(gradeSpatial(p,answerForComparison(p)!),'correct');if(p.answerInput.kind==='number')assert.equal(gradeSpatial(p,{kind:'number',value:-1}),'incorrect');if(p.answerInput.kind==='choice')assert.equal(gradeSpatial(p,{kind:'choice',value:'not-a-choice'}),'incorrect');if(id===4)for(const m of p.presentedMaterials)if(m.kind==='model')countEvidence(m.blocks);}
}});
test('intro avoids projection and height materials; all activity gates require real evidence',()=>{for(const p of [...phase2Common(1,123),...phase2Practice(1,123)])assert.ok(p.presentedMaterials.every(m=>m.kind==='model'));for(const id of [1,2,4] as const)for(const a of phase2Definitions[id].activities)assert.equal(explorationCompleted(a.interaction,phase2Activity(id)),false);});
test('adaptive assignment stable, keyed by error concepts; restoration preserves independent lesson state',()=>{let s=initialLesson(123);for(const p of phase2Common(4,123))s.attempts[p.id]={...initialAttempt(),completed:true,wrong:p.conceptTags.includes('height-map')?3:0};s=phase2EnsureAdaptive(4,s);assert.equal(s.adaptive![0].conceptTags[0],'height-map');assert.deepEqual(phase2EnsureAdaptive(4,s),s);s.solveIndex=6;s.section='solve';assert.deepEqual(phase2Restore(4,JSON.stringify(s)),s);assert.equal(phase2Restore(1,JSON.stringify(s)),null);});
