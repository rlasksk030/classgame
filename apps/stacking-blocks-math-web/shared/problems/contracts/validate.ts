import type { Problem } from './spatial.ts';
/** Contract validation precedes submission. Unsupported policies never count as wrong answers. */
export function problemContractError(p:Problem):string|null {
 const input=p.answerInput,policy=p.gradingPolicy;
 if(p.solutionEvidence){const e=p.solutionEvidence;const kind=e.solutionCount===1?'unique':e.counts.length===1?'multiple-shapes-same-count':'multiple-shapes-different-count';
  if(!Number.isInteger(e.solutionCount)||e.solutionCount<1||!e.counts.length||e.counts.some(n=>!Number.isInteger(n)||n<0)||e.classification!==kind||(e.solutionCount===1&&e.counts.length!==1))return 'SOLUTION_METADATA_MISMATCH';
  if((policy.kind==='min-count'&&policy.value!==Math.min(...e.counts))||(policy.kind==='max-count'&&policy.value!==Math.max(...e.counts)))return 'COUNT_RANGE_MISMATCH';
 }

 const compatible:Record<Problem['gradingPolicy']['kind'],Problem['answerInput']['kind']>={
  'exact-choice':'choice','exact-number':'number','exact-grid':'projection-grid','exact-height-map':'height-map','exact-layers':'layer-map','exact-block-coordinates':'block-builder','projection-constraints':'block-builder','multiple-valid-solutions':'block-builder','exact-mapping':'mapping','determinability':'boolean-judgment','min-count':'number','max-count':'number'};
 if(input.kind!==compatible[policy.kind])return 'INPUT_POLICY_MISMATCH';
 if((policy.kind==='min-count'||policy.kind==='max-count')&&(!Number.isInteger(policy.value)||!p.solutionEvidence||p.solutionEvidence.solutionCount<1))return 'SOLVER_NOT_IMPLEMENTED';
 if(policy.kind==='exact-grid'||policy.kind==='projection-constraints'){
  const entries=Object.entries(policy.grids);
  if(!entries.length)return 'EMPTY_PROJECTION_CONSTRAINT';
  for(const [face,rows]of entries){const height=face==='top'?p.grid.gridDepth:p.grid.maxHeight,width=face==='side'?p.grid.gridDepth:p.grid.gridWidth;
   if(rows.length!==height||rows.some(row=>row.length!==width||row.some(v=>typeof v!=='boolean')))return 'GRID_SHAPE_MISMATCH';
  }
  if(input.kind==='projection-grid'&&(input.faces.length!==entries.length||input.faces.some(f=>!policy.grids[f])))return 'INPUT_FACES_MISMATCH';
 }
 if(policy.kind==='exact-choice'&&input.kind==='choice'&&!input.choices.some(c=>c.id===policy.value))return 'ANSWER_CHOICE_MISSING';
 if(policy.kind==='multiple-valid-solutions'&&!policy.solutions.length)return 'SOLUTION_MISSING';
 if(new Set(p.allowedViews).size!==p.allowedViews.length||p.allowedViews.some(v=>!p.cameraPolicy.allowedViews.includes(v)))return 'CAMERA_POLICY_MISMATCH';
 return null;
}
