import type { BlockCoord, Grid2D, GridConfig } from '../../types.ts';
import { fromHeightMap,validStructure,toHeightMap,project,grid2DEqual } from '../../blocks.ts';
export const SOLVER_VERSION = 'projection-search-v1' as const;
export interface ProjectionConstraints {
 grid: GridConfig;
 projections?: Partial<Record<'top'|'front'|'side',Grid2D>>;
 heights?: (number|null)[][];
 layers?: (Grid2D|null)[];
 givenBlocks?: BlockCoord[];
 exactCount?: number;
}
export interface SearchLimits { maxNodes?:number; deadlineMs?:number; maxExamples?:number; signal?:AbortSignal; }
export interface SolutionAnalysis {
 status:'COMPLETE'; solverVersion:typeof SOLVER_VERSION; solutionCount:number;
 representativeSolutions:BlockCoord[][]; uniqueCubeCounts:number[];
 minCubeCount:number|null; maxCubeCount:number|null; isShapeUnique:boolean; isCountDeterminable:boolean;
 visitedNodes:number; elapsedMs:number;
}
export type SearchResult=SolutionAnalysis|{status:'LIMIT_REACHED'|'CANCELLED';visitedNodes:number;foundCountLowerBound:number;elapsedMs:number}|{status:'INVALID';reason:string};
const matrix=(v:unknown,r:number,c:number,p:(x:unknown)=>boolean):boolean=>Array.isArray(v)&&v.length===r&&v.every(row=>Array.isArray(row)&&row.length===c&&row.every(p));
export function constraintError(c:ProjectionConstraints):string|null {
 const {gridWidth:w,gridDepth:d,maxHeight:h}=c.grid;
 if(![w,d,h].every(n=>Number.isInteger(n)&&n>0)||w>4||d>4||w*d>12||h>4)return 'SEARCH_BOARD_OUT_OF_RANGE';
 for(const [face,g]of Object.entries(c.projections??{})){
  if(!['top','front','side'].includes(face)||!matrix(g,face==='top'?d:h,face==='side'?d:w,v=>typeof v==='boolean'))return 'INVALID_PROJECTION';
  if(face!=='top')for(let col=0;col<g[0].length;col++)for(let y=1;y<h;y++)if(g[y][col]&&!g[y-1][col])return 'FLOATING_SILHOUETTE';
 }
 if(c.heights&&!matrix(c.heights,d,w,v=>v===null||Number.isInteger(v)&&Number(v)>=0&&Number(v)<=h))return 'INVALID_HEIGHT_MAP';
 if(c.layers&&(c.layers.length>h||c.layers.some(g=>g!==null&&!matrix(g,d,w,v=>typeof v==='boolean'))))return 'INVALID_LAYERS';
 if(c.layers)for(let a=0;a<c.layers.length;a++)for(let b=a+1;b<c.layers.length;b++)for(let z=0;z<d;z++)for(let x=0;x<w;x++)if(c.layers[a]?.[z][x]===false&&c.layers[b]?.[z][x]===true)return 'FLOATING_LAYERS';
 if(c.exactCount!==undefined&&(!Number.isInteger(c.exactCount)||c.exactCount<0||c.exactCount>w*d*h))return 'INVALID_COUNT';
 const seen=new Set<string>();for(const b of c.givenBlocks??[]){if(![b.x,b.y,b.z].every(Number.isInteger)||b.x<0||b.x>=w||b.y<0||b.y>=h||b.z<0||b.z>=d)return 'INVALID_GIVEN_BLOCK';const key=`${b.x},${b.y},${b.z}`;if(seen.has(key))return 'DUPLICATE_GIVEN_BLOCK';seen.add(key);}
 return null;
}
/** Complete height-column enumeration; stored side columns are depth-1-z, not screen columns. */
export function solveProjectionConstraints(c:ProjectionConstraints,limits:SearchLimits={}):SearchResult {
 const error=constraintError(c);if(error)return {status:'INVALID',reason:error};
 const start=performance.now(),{gridWidth:w,gridDepth:d,maxHeight:h}=c.grid;
 const maxNodes=limits.maxNodes??1000000,deadline=limits.deadlineMs??1000;
 const front=c.projections?.front?.[0].map((_v,x)=>c.projections!.front!.reduce((n,r)=>n+Number(r[x]),0));
 const side=c.projections?.side?.[0].map((_v,k)=>c.projections!.side!.reduce((n,r)=>n+Number(r[k]),0)).reverse();
 const cells=Array.from({length:w*d},(_,i)=>{const x=i%w,z=Math.floor(i/w);let lo=0,hi=Math.min(h,front?.[x]??h,side?.[z]??h);
  const top=c.projections?.top?.[z][x];if(top===false)hi=0;if(top===true)lo=1;
  const height=c.heights?.[z][x];if(height!==undefined&&height!==null){lo=Math.max(lo,height);hi=Math.min(hi,height);}
  c.layers?.forEach((g,y)=>{if(g?.[z][x]===true)lo=Math.max(lo,y+1);if(g?.[z][x]===false)hi=Math.min(hi,y);});
  for(const b of c.givenBlocks??[])if(b.x===x&&b.z===z)lo=Math.max(lo,b.y+1);
  return {x,z,lo,hi};}).sort((a,b)=>(a.hi-a.lo)-(b.hi-b.lo)||a.z-b.z||a.x-b.x);
 let nodes=0,solutions=0,halt:'LIMIT_REACHED'|'CANCELLED'|null=null;
 const values=Array.from({length:d},()=>Array<number>(w).fill(-1));const counts=new Set<number>();
 let minExample:BlockCoord[]|null=null,maxExample:BlockCoord[]|null=null,second:BlockCoord[]|null=null,min=Infinity,max=-Infinity;
 function feasible(i:number,sum:number){let lower=sum,upper=sum;for(let j=i;j<cells.length;j++){lower+=cells[j].lo;upper+=cells[j].hi;}
  if(c.exactCount!==undefined&&(lower>c.exactCount||upper<c.exactCount))return false;
  if(front)for(let x=0;x<w;x++){let possible=0;for(let z=0;z<d;z++)possible=Math.max(possible,values[z][x]);for(let j=i;j<cells.length;j++)if(cells[j].x===x)possible=Math.max(possible,cells[j].hi);if(possible<front[x])return false;}
  if(side)for(let z=0;z<d;z++){let possible=Math.max(...values[z]);for(let j=i;j<cells.length;j++)if(cells[j].z===z)possible=Math.max(possible,cells[j].hi);if(possible<side[z])return false;}
  return true;
 }
 function visit(i:number,sum:number){
  if(halt)return;if(limits.signal?.aborted){halt='CANCELLED';return;}if(nodes>=maxNodes||performance.now()-start>deadline){halt='LIMIT_REACHED';return;}nodes++;
  if(!feasible(i,sum))return;
  if(i===cells.length){solutions++;counts.add(sum);if(sum<min){min=sum;minExample=fromHeightMap(values);}if(sum>max){max=sum;maxExample=fromHeightMap(values);}if(solutions===2)second=fromHeightMap(values);return;}
  const cell=cells[i];for(let v=cell.lo;v<=cell.hi;v++){values[cell.z][cell.x]=v;visit(i+1,sum+v);if(halt)break;}values[cell.z][cell.x]=-1;
 }
 if(cells.every(c=>c.lo<=c.hi))visit(0,0);
 const elapsedMs=performance.now()-start;
 if(halt)return {status:halt,visitedNodes:nodes,foundCountLowerBound:solutions,elapsedMs};
 const examples=minExample?[minExample,...(max!==min&&maxExample?[maxExample]:second?[second]:[])]:[];
 return {status:'COMPLETE',solverVersion:SOLVER_VERSION,solutionCount:solutions,representativeSolutions:examples.slice(0,Math.max(0,Math.min(2,limits.maxExamples??2))),uniqueCubeCounts:[...counts].sort((a,b)=>a-b),minCubeCount:solutions?min:null,maxCubeCount:solutions?max:null,isShapeUnique:solutions===1,isCountDeterminable:solutions>0&&counts.size===1,visitedNodes:nodes,elapsedMs};
}
export function analyzeSolutions(c:ProjectionConstraints):SolutionAnalysis {const result=solveProjectionConstraints(c);if(result.status!=='COMPLETE'||!result.solutionCount)throw new Error(`UNPUBLISHABLE_CONSTRAINTS:${result.status}`);return result;}
export const findRepresentativeSolutions=(c:ProjectionConstraints)=>analyzeSolutions(c).representativeSolutions;
export const calculateCountRange=(c:ProjectionConstraints)=>{const r=analyzeSolutions(c);return {min:r.minCubeCount!,max:r.maxCubeCount!};};
export const isCountDeterminable=(c:ProjectionConstraints)=>analyzeSolutions(c).isCountDeterminable;
export function validatedHeightBlocks(grid:GridConfig,heights:number[][]){const c={grid,heights};const error=constraintError(c);if(error||heights.flat().some(v=>v===null))throw new Error(error??'INCOMPLETE_HEIGHT');return fromHeightMap(heights);}
export function validatedLayerBlocks(grid:GridConfig,layers:Grid2D[]){const error=constraintError({grid,layers});if(error||layers.length!==grid.maxHeight)throw new Error(error??'INCOMPLETE_LAYERS');return fromHeightMap(Array.from({length:grid.gridDepth},(_,z)=>Array.from({length:grid.gridWidth},(_,x)=>layers.reduce((n,g)=>n+Number(g[z][x]),0))));}

/** Lightweight submission verification: never enumerates alternative models. */
export function satisfiesProjectionConstraints(c:ProjectionConstraints,blocks:BlockCoord[]):boolean {
 if(constraintError(c)||!validStructure(blocks,c.grid))return false;
 const heights=toHeightMap(blocks,c.grid),projections=project(blocks,c.grid);
 for(const face of ['top','front','side'] as const)if(c.projections?.[face]&&!grid2DEqual(projections[face],c.projections[face]!))return false;
 if(c.exactCount!==undefined&&blocks.length!==c.exactCount)return false;
 for(let z=0;z<c.grid.gridDepth;z++)for(let x=0;x<c.grid.gridWidth;x++){
  const h=c.heights?.[z][x];if(h!==undefined&&h!==null&&heights[z][x]!==h)return false;
  for(let y=0;y<(c.layers?.length??0);y++){const value=c.layers?.[y]?.[z][x];if(value!==undefined&&value!==(heights[z][x]>y))return false;}
 }
 return (c.givenBlocks??[]).every(b=>heights[b.z][b.x]>b.y);
}
