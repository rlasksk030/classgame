import { projectionToDisplayGrid, projectionDisplayCellToMathCoord } from '../../../shared/problems/contracts/display.ts';
interface Props {face?:'top'|'front'|'side';title:string;rows:(boolean|number|null)[][];numeric?:boolean;maximum?:number;floor?:boolean;readOnly?:boolean;onChange?:(row:number,col:number,value:boolean|number)=>void;onCell?:(row:number,col:number)=>void;marked?:boolean[][];}
export default function MathGrid({title,rows,face,numeric=false,maximum=3,floor=false,readOnly=false,onChange,onCell,marked}:Props){
 const display=projectionToDisplayGrid(rows,face);
 return <section className={`math-grid ${floor?'math-grid-floor':''}`} aria-label={title}>
 <h3>{title}</h3><div className="math-grid-frame"><div className="math-grid-cells" style={{gridTemplateColumns:`repeat(${rows[0]?.length??0},48px)`}}>
 {display.flatMap((cells,r)=>cells.map((value,c)=>{const pos=projectionDisplayCellToMathCoord(r,c,rows.length,rows[0]?.length??0,face);const changed=marked?.[pos.row]?.[pos.col];return numeric&&!readOnly
 ? <input key={`${r}-${c}`} className="math-cell" aria-label={`${title} ${r+1}행 ${c+1}열`} type="number" min={0} max={maximum} value={Number(value)} onChange={e=>onChange?.(pos.row,pos.col,Math.max(0,Math.min(maximum,Number(e.target.value))))}/>
 : <button key={`${r}-${c}`} className={`math-cell ${value?'filled':''} ${changed?'changed':''}`} type="button" aria-label={`${title} ${r+1}행 ${c+1}열`} aria-pressed={numeric?undefined:Boolean(value)} disabled={readOnly&&!onCell} onClick={()=>{onCell?.(pos.row,pos.col);if(!readOnly)onChange?.(pos.row,pos.col,!value);}}>{numeric?(value===null?'?':Number(value)):value?'●':''}</button>;}))}
 </div>{floor&&<><span className="math-front">앞</span><span className="math-side">옆</span></>}</div>
 </section>;
}
