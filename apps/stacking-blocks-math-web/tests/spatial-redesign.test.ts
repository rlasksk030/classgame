import test from 'node:test';
import assert from 'node:assert/strict';
import { project, toHeightMap, toLayers, placeOnColumn, removeBlock, validStructure } from '../shared/blocks.ts';
import { projectionForDirection } from '../shared/spatialConventions.ts';
import { mathGridToDisplayGrid, displayCellToMathCoord } from '../shared/problems/contracts/display.ts';
import { LESSON3_GRID, LESSON3_MODEL, lesson3Problem, modelForSeed, commonProblems, adaptiveProblems, practiceProblems } from '../shared/problems/templates/lesson3.ts';
import { emptyAnswer, gradeSpatial, answerForComparison, initialAttempt, applyLearningAttempt } from '../shared/problems/grading/spatial.ts';
import { initialLesson, restoreLesson, localProgressKey, ensureAdaptive } from '../shared/progress/spatial.ts';
const top=[[true,true,false],[false,true,false],[false,false,true]];
const front=[[true,true,true],[false,true,true],[false,false,true]];
const right=[[true,true,true],[true,false,true],[true,false,false]];
test('P01-03 independent asymmetric top/front/right expected grids',()=>{assert.deepEqual(project(LESSON3_MODEL,LESSON3_GRID),{top,front,side:right});});
test('P04-05 display bottom is z0/front and every cell has inverse mapping',()=>{const display=mathGridToDisplayGrid(top);assert.deepEqual(display[2],[true,true,false]);for(let r=0;r<3;r++)for(let c=0;c<3;c++){const p=displayCellToMathCoord(r,c,3);assert.equal(display[r][c],top[p.row][p.col]);}assert.deepEqual(mathGridToDisplayGrid(mathGridToDisplayGrid(top)),top);});
test('height and layer maps use the identical display adapter',()=>{assert.deepEqual(mathGridToDisplayGrid(toHeightMap(LESSON3_MODEL,LESSON3_GRID)).at(-1),[1,2,0]);assert.deepEqual(mathGridToDisplayGrid(toLayers(LESSON3_MODEL,LESSON3_GRID)[0]).at(-1),[true,true,false]);});
test('P06 addition changes front cell only, using fixed expectations',()=>{const result=placeOnColumn(LESSON3_MODEL,0,0,LESSON3_GRID);assert.equal(result.check.ok,true);assert.deepEqual(project(result.blocks,LESSON3_GRID),{top,side:right,front:[[true,true,true],[true,true,true],[false,false,true]]});});
test('P07 removal changes independently expected front/right heights',()=>{const result=removeBlock(LESSON3_MODEL,{x:2,y:2,z:2});assert.equal(result.check.ok,true);assert.deepEqual(project(result.blocks,LESSON3_GRID),{top,front:[[true,true,true],[false,true,true],[false,false,false]],side:[[true,true,true],[true,false,true],[false,false,false]]});});
test('P08 floating, duplicate, and out of bounds coordinates rejected',()=>{assert.equal(validStructure([{x:0,y:1,z:0}],LESSON3_GRID),false);assert.equal(validStructure([{x:3,y:0,z:0}],LESSON3_GRID),false);assert.equal(validStructure([...LESSON3_MODEL,LESSON3_MODEL[0]],LESSON3_GRID),false);});
test('P09 actual display clicks produce canonical projection answer',()=>{const p=lesson3Problem('top',11,'solve',0);p.gradingPolicy={kind:'exact-grid',grids:{top}};const a=emptyAnswer(p);assert.equal(a.kind,'projection-grid');if(a.kind!=='projection-grid')return;const display=mathGridToDisplayGrid(top);for(let r=0;r<3;r++)for(let c=0;c<3;c++)if(display[r][c]){const m=displayCellToMathCoord(r,c,3);a.grids.top![m.row][m.col]=true;}assert.equal(gradeSpatial(p,a),'correct');});
test('P10 right side differs from left on fixed asymmetric fixture',()=>{assert.deepEqual(projectionForDirection(LESSON3_MODEL,LESSON3_GRID,'right'),right);assert.deepEqual(projectionForDirection(LESSON3_MODEL,LESSON3_GRID,'left'),[[true,true,true],[true,false,true],[false,false,true]]);const p=lesson3Problem('side',11,'solve',0);p.gradingPolicy={kind:'exact-grid',grids:{side:right}};assert.equal(gradeSpatial(p,{kind:'projection-grid',grids:{side:right}}),'correct');assert.equal(gradeSpatial(p,{kind:'projection-grid',grids:{side:projectionForDirection(LESSON3_MODEL,LESSON3_GRID,'left')}}),'incorrect');});
test('deterministic bounded generator, separated direction projections, all outputs solvable',()=>{for(const seed of [0,1,2,123,314159,2147483647,4294967295]){assert.deepEqual(modelForSeed(seed),modelForSeed(seed));const proj=project(modelForSeed(seed),LESSON3_GRID);assert.equal(new Set(Object.values(proj).map(g=>JSON.stringify(g))).size,3);for(const p of [...commonProblems(seed),...adaptiveProblems(seed,{}),...practiceProblems(seed,10)]){assert.ok(validStructure(p.presentedMaterials.find(m=>m.kind==='model')!.blocks,LESSON3_GRID));assert.equal(gradeSpatial(p,answerForComparison(p)!), 'correct');}}});
test('adaptive four reflect tags and are assigned only after six completions',()=>{let s=initialLesson(11);assert.equal(ensureAdaptive(s).adaptive,null);for(const p of commonProblems(s.seed))s.attempts[p.id]={...initialAttempt(),completed:true,wrong:p.conceptTags.includes('projection-side')?2:0};s=ensureAdaptive(s);assert.equal(s.adaptive?.length,4);assert.ok(s.adaptive?.every(p=>p.conceptTags.includes('projection-side')));assert.deepEqual(ensureAdaptive(s),s);assert.ok(adaptiveProblems(11,{}).every(p=>p.stage==='challenge'));});
test('four feedback stages reveal only on fourth wrong, then student corrects',()=>{const p=lesson3Problem('side-choice',11,'solve',0);let a=initialAttempt();for(let i=1;i<=4;i++){a=applyLearningAttempt(p,{kind:'choice',value:'top'},a);assert.equal(a.wrong,i);assert.equal(a.revealed,i===4);assert.equal(a.completed,false);}a=applyLearningAttempt(p,{kind:'choice',value:'side'},a);assert.equal(a.completed,true);assert.equal(a.revealed,true);});
test('all answers and current position serialize in isolated version namespace',()=>{const s=initialLesson(11);s.section='solve';s.solveIndex=3;const p=commonProblems(11)[3];s.answers[p.id]=answerForComparison(p)!;assert.deepEqual(restoreLesson(JSON.stringify(s)),s);assert.notEqual(localProgressKey('one','i','s','c'),localProgressKey('two','i','s','c'));assert.equal(restoreLesson('{"version":"legacy"}'),null);});
test('empty constraints and unimplemented min/max cannot silently pass',()=>{const p=lesson3Problem('front',11,'solve',0);p.answerInput={kind:'block-builder'};p.gradingPolicy={kind:'projection-constraints',grids:{},example:LESSON3_MODEL};assert.equal(gradeSpatial(p,{kind:'block-builder',blocks:LESSON3_MODEL}),'unsupported');p.answerInput={kind:'number',min:0,max:27};p.gradingPolicy={kind:'min-count',solver:'projection-search-v1',constraints:{front}};assert.equal(gradeSpatial(p,{kind:'number',value:1}),'unsupported');});

import { LESSON3_ACTIVITIES, activityCompleted } from '../shared/curriculum/lesson3.ts';
import { initialActivity } from '../shared/progress/spatial.ts';
test('learn requires real actions; prediction alone or next clicks cannot complete',()=>{for(const def of LESSON3_ACTIVITIES)assert.equal(activityCompleted(def,initialActivity()),false);const a=initialActivity();a.views=['top','side'];assert.equal(activityCompleted(LESSON3_ACTIVITIES[0],a),true);a.top[0][0]=true;assert.equal(activityCompleted(LESSON3_ACTIVITIES[1],a),true);a.prediction=['front'];a.predictionConfirmed=true;a.blocks=[...LESSON3_MODEL,{x:0,y:1,z:0}];assert.equal(activityCompleted(LESSON3_ACTIVITIES[4],a),false);a.changeCompared=true;assert.equal(activityCompleted(LESSON3_ACTIVITIES[4],a),true);});

import { observedView } from '../shared/problems/contracts/camera.ts';
test('actual canonical camera offsets distinguish right side from left/back',()=>{assert.equal(observedView({x:0,y:0,z:-5}),'front');assert.equal(observedView({x:5,y:0,z:0}),'side');assert.equal(observedView({x:-5,y:0,z:0}),'free');assert.equal(observedView({x:0,y:5,z:0}),'top');assert.equal(observedView({x:0,y:0,z:5}),'free');});

import { projectionToDisplayGrid, projectionDisplayCellToMathCoord } from '../shared/problems/contracts/display.ts';
test('right observer display mirrors legacy storage columns with exact inverse, not stored answers',()=>{
 const before=JSON.stringify(right);
 assert.deepEqual(projectionToDisplayGrid(right,'side'),[[false,false,true],[true,false,true],[true,true,true]]);
 for(let r=0;r<3;r++)for(let c=0;c<3;c++){
  const p=projectionDisplayCellToMathCoord(r,c,3,3,'side');
  assert.equal(projectionToDisplayGrid(right,'side')[r][c],right[p.row][p.col]);
 }
 assert.equal(JSON.stringify(right),before);
});
