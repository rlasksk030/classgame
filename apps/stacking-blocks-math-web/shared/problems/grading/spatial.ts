import { satisfiesProjectionConstraints } from '../solvers/projection.ts';
import { problemContractError } from '../contracts/validate.ts';
import { blocksEqual, grid2DEqual, heightMapEqual, project, validStructure } from '../../blocks.ts';
import type { AnswerState, Problem, Face } from '../contracts/spatial.ts';
export function gradeSpatial(problem: Problem, answer: AnswerState): 'correct' | 'incorrect' | 'unsupported' {
 if (problemContractError(problem) || answer.kind !== problem.answerInput.kind) return 'unsupported';
 const p = problem.gradingPolicy;
 let correct = false;
 const same = (a: boolean[][], b: boolean[][]) => grid2DEqual(a,b);
 switch(p.kind) {
  case 'exact-choice': correct = answer.kind === 'choice' && answer.value === p.value; break;
  case 'exact-number': correct = answer.kind === 'number' && answer.value === p.value; break;
  case 'determinability': correct = answer.kind === 'boolean-judgment' && answer.value === p.determinable; break;
  case 'exact-grid': { const faces = Object.keys(p.grids) as Face[]; correct = faces.length > 0 && answer.kind === 'projection-grid' && faces.every(f => same(answer.grids[f] ?? [],p.grids[f]!)); break; }
  case 'exact-height-map': correct = answer.kind === 'height-map' && heightMapEqual(answer.grid,p.grid); break;
  case 'exact-layers': correct = answer.kind === 'layer-map' && answer.grids.length === p.grids.length && p.grids.every((g,i) => same(g,answer.grids[i])); break;
  case 'exact-mapping': correct = answer.kind === 'mapping' && Object.entries(p.values).every(([key,value]) => answer.values[key] === value); break;
  case 'exact-block-coordinates': correct = answer.kind === 'block-builder' && validStructure(answer.blocks,problem.grid) && blocksEqual(answer.blocks,p.blocks); break;
  case 'projection-constraints': {
   if (answer.kind !== 'block-builder' || !validStructure(answer.blocks,problem.grid)) break;
   const faces = Object.keys(p.grids) as Face[]; const actual = project(answer.blocks,problem.grid);
   correct = faces.length > 0 && faces.every(f => same(actual[f],p.grids[f]!)) && (!p.constraints||satisfiesProjectionConstraints(p.constraints,answer.blocks)); break;
  }
  case 'multiple-valid-solutions': correct = answer.kind === 'block-builder' && validStructure(answer.blocks,problem.grid) && p.solutions.some(b => blocksEqual(b,answer.blocks)); break;
  case 'min-count': case 'max-count': correct=answer.kind==='number'&&answer.value===p.value; break;
 }
 return correct ? 'correct' : 'incorrect';
}
export function emptyAnswer(problem: Problem): AnswerState {
 const {grid,answerInput:i} = problem;
 const blank = (r:number,c:number) => Array.from({length:r},()=>Array<boolean>(c).fill(false));
 switch(i.kind) {
  case 'choice': return {kind:i.kind,value:null};
  case 'number': return {kind:i.kind,value:null};
  case 'boolean-judgment': return {kind:i.kind,value:null};
  case 'mapping': return {kind:i.kind,values:{}};
  case 'projection-grid': return {kind:i.kind,grids:Object.fromEntries(i.faces.map(f=>[f,blank(f==='top'?grid.gridDepth:grid.maxHeight,f==='side'?grid.gridDepth:grid.gridWidth)]))};
  case 'height-map': return {kind:i.kind,grid:Array.from({length:grid.gridDepth},()=>Array<number>(grid.gridWidth).fill(0))};
  case 'layer-map': return {kind:i.kind,grids:Array.from({length:i.layers},()=>blank(grid.gridDepth,grid.gridWidth))};
  case 'block-builder': return {kind:i.kind,blocks:[]};
 }
}
export function answerForComparison(problem: Problem): AnswerState | null {
 const p=problem.gradingPolicy;
 switch(p.kind) {
  case 'exact-choice': return {kind:'choice',value:p.value};
  case 'exact-number': return {kind:'number',value:p.value};
  case 'min-count': case 'max-count': return p.value===undefined?null:{kind:'number',value:p.value};
  case 'determinability': return {kind:'boolean-judgment',value:p.determinable};
  case 'exact-grid': return {kind:'projection-grid',grids:p.grids};
  case 'exact-height-map': return {kind:'height-map',grid:p.grid};
  case 'exact-layers': return {kind:'layer-map',grids:p.grids};
  case 'exact-mapping': return {kind:'mapping',values:p.values};
  case 'exact-block-coordinates': return {kind:'block-builder',blocks:p.blocks};
  case 'projection-constraints': return {kind:'block-builder',blocks:p.example};
  case 'multiple-valid-solutions': return {kind:'block-builder',blocks:p.solutions[0]??[]};
  default: return null;
 }
}
export interface LearningAttempt { wrong: number; completed: boolean; revealed: boolean; submitted: AnswerState | null; }
export const initialAttempt = (): LearningAttempt => ({wrong:0,completed:false,revealed:false,submitted:null});
export function applyLearningAttempt(p:Problem,a:AnswerState,prev:LearningAttempt):LearningAttempt {
 if(prev.completed || gradeSpatial(p,a)==='unsupported') return prev;
 const correct=gradeSpatial(p,a)==='correct';
 return {wrong:prev.wrong+(correct?0:1),completed:correct,revealed:prev.revealed||(!correct&&prev.wrong>=3),submitted:structuredClone(a)};
}
