// Server-only adapter: never import the private bank into a student component.
import { generatePeerPracticeBank } from '../../../shared/peerPracticeBank.ts';
import { generatedProblemId } from '../../../shared/practiceSet.ts';
import { challengeGiven, ACTIVITY_GRID, type ChallengeType } from '../../../shared/activities.ts';
import { grade } from '../../../shared/grading.ts';
import { validStructure } from '../../../shared/blocks.ts';
import type { BlockCoord } from '../../../shared/types.ts';
export interface ChallengeRow { id:string; class_id:string; author_id:string|null; share_code:string; source:'student'|'system'; blocks:BlockCoord[]; challenge_type:ChallengeType; hint_type:ChallengeType; }
let bank:ReturnType<typeof generatePeerPracticeBank>|undefined;
export async function systemChallengeRows(classId:string):Promise<ChallengeRow[]> {
 bank??=generatePeerPracticeBank();
 return Promise.all(bank.map(async p=>{const id=await generatedProblemId(`${classId}:${p.id}`);return {id,class_id:classId,author_id:null,share_code:`S${id.replaceAll('-','').slice(0,11).toUpperCase()}`,source:'system',grid_width:5,grid_depth:5,max_height:3,blocks:p.blocks,challenge_type:'views',hint_type:p.hint.type};}));
}
export function challengeCard(c:ChallengeRow,completed:boolean){
 return {code:c.share_code,source:c.source,title:c.source==='system'?'기본 연습 문제':'친구가 만든 문제',given:challengeGiven(c.blocks,c.challenge_type),completed};
}
export function challengeCorrect(c:ChallengeRow,blocks:BlockCoord[],hintShown:boolean){
 if(!validStructure(blocks,ACTIVITY_GRID)||blocks.length!==10)return false;
 const matches=(type:ChallengeType)=>grade({problemType:'BUILD_FROM_VIEWS',gradingMode:['views','top'].includes(type)?'constraint':'exact',answer:{kind:'blocks',blocks:c.blocks},submission:{kind:'blocks',blocks},given:challengeGiven(c.blocks,type),grid:ACTIVITY_GRID}).correct;
 return matches(c.challenge_type)&&(!hintShown||matches(c.hint_type));
}
export function solveState(row:Record<string,unknown>|null){return {wrongCount:Number(row?.wrong_count??0),hintShown:Boolean(row?.used_hint),answerRevealed:Boolean(row?.answer_revealed),completed:Boolean(row?.correct),score:Number(row?.score??0)};}
