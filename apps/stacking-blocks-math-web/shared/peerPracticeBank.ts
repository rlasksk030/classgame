/** Generated, oracle-accepted system practice. Never presented as a classmate. */
import { fromHeightMap } from './blocks.ts';
import { PEER_GRID, makeChallengeCard, type PeerChallenge } from './phase4.ts';
import { randomFor } from './contentBank.ts';
import { oracleProject, oracleHeightMap, oracleLayers, oracleIsValidStructure } from '../oracle/geometry.ts';
import { solveViewConstraint } from '../oracle/dfs.ts';

export function generatePeerPracticeBank(seed=20260919,count=24):PeerChallenge[] {
 if(!Number.isInteger(count)||count<20||count>30)throw new Error('PEER_BANK_SIZE');
 const random=randomFor(seed),result:PeerChallenge[]=[],seen=new Set<string>();
 for(let trial=0;result.length<count&&trial<2000;trial++){
  const heights=Array.from({length:3},()=>[0,0,0]);
  for(let n=0;n<10;n++){const available=heights.flatMap((row,z)=>row.flatMap((h,x)=>h<3?[{x,z}]:[]));const cell=available[Math.floor(random()*available.length)];heights[cell.z][cell.x]++;}
  const blocks=fromHeightMap(heights),card=makeChallengeCard(blocks,'views'),hint=makeChallengeCard(blocks,result.length%2?'layers':'heightMap');
  const signature=JSON.stringify(card.projections);
  if(seen.has(signature))continue;
  const independent=oracleProject(blocks,PEER_GRID);
  if(!oracleIsValidStructure(blocks,PEER_GRID)||blocks.length!==10||JSON.stringify(independent)!==signature)throw new Error('PEER_ORACLE_REJECTED');
  const expectedHint=hint.type==='layers'?oracleLayers(blocks,PEER_GRID):oracleHeightMap(blocks,PEER_GRID);
  if(JSON.stringify(expectedHint)!==JSON.stringify(hint.layers??hint.heightMap))throw new Error('PEER_HINT_REJECTED');
  // A witness proves existence; complete enumeration is used here only on small generated models.
  const solved=solveViewConstraint(independent,PEER_GRID,{exactCount:10,solutionCap:Number.MAX_SAFE_INTEGER});
  if(!solved.exists||solved.capped)continue;
  seen.add(signature);
  result.push({id:`system-practice-v1-${seed}-${result.length+1}`,version:1,classId:'SYSTEM_PRACTICE',authorId:'SYSTEM',title:`시스템 연습 문제 ${result.length+1}`,blocks,card,hint,published:true,hidden:false});
 }
 if(result.length!==count)throw new Error('PEER_BANK_INSUFFICIENT');
 return result;
}
/** Data selection contract: genuine peer content takes priority, system practice is explicitly separate. */
export function selectPeerPractice<T>(classmateProblems:T[],bank:PeerChallenge[],minimum=3){
 return {classmateProblems,systemPractice:classmateProblems.length>=minimum?[]:bank.slice(0,minimum-classmateProblems.length)};
}
