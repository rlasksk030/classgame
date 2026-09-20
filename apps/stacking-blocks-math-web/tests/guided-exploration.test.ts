import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPLORATIONS, START_BLOCKS, explorationDisplayProjections, INFORMATION_MODELS, EXPLORATION_GRID, CONSTRAINT_EXAMPLES, CONSTRAINT_TARGET, CONSTRAINT_GRID, editExplorationLayer, matchesExplorationConditions } from '../src/features/activities/explorationActivities.ts';
import { project, toLayers, fromLayers, validStructure } from '../shared/blocks.ts';

test('every live lesson has an explicit, concept-specific exploration instead of a free-build default',()=>{
 assert.deepEqual(Object.keys(EXPLORATIONS),Array.from({length:12},(_,i)=>String(i+1)));
 assert.deepEqual(Object.values(EXPLORATIONS).map(g=>g.kind),['count','viewpoints','projections','height-layers','information','constraints','height-edit','layer-edit','peer','architecture','presentation','connections']);
 for(const guide of Object.values(EXPLORATIONS))for(const field of ['observe','manipulate','discover'] as const)assert.ok(guide[field].length>10);
 assert.equal(EXPLORATIONS[13],undefined);
});
test('lesson5 reveals two distinct counts only after the same supplied front projection',()=>{
 assert.deepEqual(INFORMATION_MODELS.map(b=>b.length),[3,4]);
 assert.deepEqual(project(INFORMATION_MODELS[0],EXPLORATION_GRID).front,project(INFORMATION_MODELS[1],EXPLORATION_GRID).front);
 assert.notDeepEqual(project(INFORMATION_MODELS[0],EXPLORATION_GRID).top,project(INFORMATION_MODELS[1],EXPLORATION_GRID).top);
});
test('lesson6 bounded exhaustive examples have true minimum6 and maximum8 and multiple minimum models',()=>{
 // Independent heights condition: all occupied, both rows/columns reach2.
 const independent:number[]=[];
 for(let a=1;a<=2;a++)for(let b=1;b<=2;b++)for(let c=1;c<=2;c++)for(let d=1;d<=2;d++)if(Math.max(a,b)===2&&Math.max(c,d)===2&&Math.max(a,c)===2&&Math.max(b,d)===2)independent.push(a+b+c+d);
 assert.deepEqual(CONSTRAINT_EXAMPLES.map(b=>b.length),independent.sort());
 assert.equal(CONSTRAINT_EXAMPLES[0].length,6);assert.equal(CONSTRAINT_EXAMPLES.at(-1)!.length,8);
 assert.ok(CONSTRAINT_EXAMPLES.filter(b=>b.length===6).length>1);
 for(const blocks of CONSTRAINT_EXAMPLES){assert.ok(validStructure(blocks,CONSTRAINT_GRID));assert.deepEqual(project(blocks,CONSTRAINT_GRID),CONSTRAINT_TARGET);}
 assert.equal(matchesExplorationConditions([]),false);
 assert.equal(matchesExplorationConditions([...CONSTRAINT_EXAMPLES[0],{x:3,y:0,z:0}]),false);
});
test('lesson8 editing a layer rejects unsupported additions and removal under another block without changing input',()=>{
 const layers=toLayers([{x:0,y:0,z:0},{x:0,y:1,z:0}],EXPLORATION_GRID);const before=JSON.stringify(layers);
 const remove=layers[0].map(r=>[...r]);remove[0][0]=false;
 assert.equal(editExplorationLayer(layers,0,remove),null);
 const floating=layers[1].map(r=>[...r]);floating[1][1]=true;
 assert.equal(editExplorationLayer(layers,1,floating),null);assert.equal(JSON.stringify(layers),before);
 const upper=layers[1].map(r=>[...r]);upper[0][0]=false;
 const edited=editExplorationLayer(layers,1,upper)!;assert.equal(fromLayers(edited).length,1);assert.ok(validStructure(fromLayers(edited),EXPLORATION_GRID));
});

test('right-side exploration presentation matches +X camera without changing stored projections',()=>{
 const stored=project(START_BLOCKS,{...EXPLORATION_GRID,maxHeight:2});const before=JSON.stringify(stored);
 const shown=explorationDisplayProjections(stored);
 assert.deepEqual(shown.side,[[true,true,true],[true,false,false]]);
 assert.equal(JSON.stringify(stored),before);assert.deepEqual(shown.front,stored.front);assert.deepEqual(shown.top,stored.top);
});
