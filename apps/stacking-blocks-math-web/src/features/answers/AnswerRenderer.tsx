import type { AnswerState, Problem } from '../../../shared/problems/contracts/spatial.ts';
import { FACE_LABELS } from '../../../shared/problems/templates/lesson3.ts';
import MathGrid from './MathGrid';
import ActivityBuilder from '../activities/ActivityBuilder';
export default function AnswerRenderer({problem,answer,onChange,readOnly=false}:{problem:Problem;answer:AnswerState;onChange:(a:AnswerState)=>void;readOnly?:boolean}) {
 const input=problem.answerInput;
 if(input.kind!==answer.kind)return <p role="alert">문제를 표시하지 못했어요. 답안 형식이 맞지 않습니다.</p>;
 switch(answer.kind){
 case 'choice': return input.kind==='choice'&&<div className="spatial-choices" aria-label="선택 답안">{input.choices.map(c=><button className="btn" type="button" aria-pressed={answer.value===c.id} key={c.id} disabled={readOnly} onClick={()=>onChange({kind:'choice',value:c.id})}>{c.label}</button>)}</div>;
 case 'boolean-judgment':return input.kind==='boolean-judgment'&&<div className="spatial-choices">{[true,false].map(v=><button className="btn" key={String(v)} aria-pressed={answer.value===v} disabled={readOnly} onClick={()=>onChange({kind:'boolean-judgment',value:v})}>{v?input.yesLabel:input.noLabel}</button>)}</div>;
 case 'number':return input.kind==='number'&&<label>개수 <input className="field" type="number" min={input.min} max={input.max} value={answer.value??''} readOnly={readOnly} onChange={e=>onChange({kind:'number',value:e.target.value===''?null:Number(e.target.value)})}/></label>;
 case 'projection-grid':return input.kind==='projection-grid'&&<div className="spatial-grids">{input.faces.map(face=><MathGrid key={face} face={face} title={`${FACE_LABELS[face]} 답안`} rows={answer.grids[face]??[]} floor={face==='top'} readOnly={readOnly} onChange={(r,c,v)=>onChange({...answer,grids:{...answer.grids,[face]:answer.grids[face]!.map((row,ri)=>row.map((cell,ci)=>ri===r&&ci===c?Boolean(v):cell))}})}/>)}</div>;
 case 'height-map':return <MathGrid title="높이 답안" rows={answer.grid} floor numeric maximum={problem.grid.maxHeight} readOnly={readOnly} onChange={(r,c,v)=>onChange({...answer,grid:answer.grid.map((row,ri)=>row.map((cell,ci)=>ri===r&&ci===c?Number(v):cell))})}/>;
 case 'layer-map':return <div className="spatial-grids">{answer.grids.map((grid,i)=><MathGrid key={i} title={`${i+1}층 답안`} rows={grid} floor readOnly={readOnly} onChange={(r,c,v)=>onChange({...answer,grids:answer.grids.map((g,j)=>j===i?g.map((row,ri)=>row.map((cell,ci)=>ri===r&&ci===c?Boolean(v):cell)):g)})}/>)}</div>;
 case 'block-builder':return <ActivityBuilder blocks={answer.blocks} grid={problem.grid} disabled={readOnly} onChange={blocks=>onChange({kind:'block-builder',blocks})}/>;
 case 'mapping':return input.kind==='mapping'&&<div className="spatial-mapping">{input.entries.map(entry=><fieldset key={entry}><legend>{entry}</legend>{input.choices.map(c=><button key={c.id} className="btn" disabled={readOnly} aria-pressed={answer.values[entry]===c.id} onClick={()=>onChange({...answer,values:{...answer.values,[entry]:c.id}})}>{c.label}</button>)}</fieldset>)}</div>;
 }
}
