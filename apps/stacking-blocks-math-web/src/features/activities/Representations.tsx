import { ProjectionGrid } from '../../components/world/ProjectionGrid';
import type { ProblemGiven } from '../../../shared/types.ts';
export default function Representations({given}:{given:ProblemGiven}) {
 return <div className="toolbar-row" style={{flexWrap:'wrap'}}>
 {(['top','front','side'] as const).map(face=>given.projections?.[face]&&<ProjectionGrid key={face} title={{top:'위',front:'앞',side:'옆(오른쪽에서 본 모양)'}[face]} rows={given.projections[face]!} reverseRows={face!=='top'} mirrorColumns={face==='side'} orientation={face==='top'?'floor':undefined} editable={false} onChange={()=>undefined} valueType="boolean"/>)}
 {given.heightMap&&<ProjectionGrid title="자리별 높이" rows={given.heightMap} orientation="floor" editable={false} onChange={()=>undefined} valueType="number"/>}
 {given.layers?.map((rows,i)=><ProjectionGrid key={i} title={`${i+1}층`} rows={rows} orientation="floor" editable={false} onChange={()=>undefined} valueType="boolean"/>)}
 </div>;
}
