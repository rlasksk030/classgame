import { ProjectionGrid } from '../../components/world/ProjectionGrid';
import type { ProblemGiven } from '../../../shared/types.ts';
export default function Representations({given}:{given:ProblemGiven}) {
 return <div className="toolbar-row" style={{flexWrap:'wrap'}}>
 {(['top','front','side'] as const).map(face=>given.projections?.[face]&&<ProjectionGrid key={face} title={{top:'위',front:'앞',side:'옆'}[face]} rows={given.projections[face]!} reverseRows={face!=='top'} editable={false} onChange={()=>undefined} valueType="boolean"/>)}
 {given.heightMap&&<ProjectionGrid title="자리별 높이" rows={given.heightMap} editable={false} onChange={()=>undefined} valueType="number"/>}
 {given.layers?.map((rows,i)=><ProjectionGrid key={i} title={`${i+1}층`} rows={rows} editable={false} onChange={()=>undefined} valueType="boolean"/>)}
 </div>;
}
