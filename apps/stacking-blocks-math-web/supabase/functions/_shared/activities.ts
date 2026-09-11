import { ACTIVITY_GRID, challengeGiven, challengeScore, validBuilding, validChallenge, type Building, type ChallengeType } from '../../../shared/activities.ts';
import { canonicalize, validStructure } from '../../../shared/blocks.ts';
import { grade } from '../../../shared/grading.ts';
import { applyAttempt } from '../../../shared/attempts.ts';
import type { BlockCoord } from '../../../shared/types.ts';
import { generateShareCode } from './security.ts';
import { fail,ok,text } from './http.ts';
import type { serviceClient } from './db.ts';
export async function activityRequest(db:ReturnType<typeof serviceClient>, body:Record<string,unknown>, student:{studentId:string;classId:string}) {
 const action=String(body.action);
 const lesson=action.includes('challenge')?9:action.includes('review')?12:body.lesson===11?11:10;
 const {data:lock,error:lockError}=await db.from('sb_lesson_settings').select('locked').eq('class_id',student.classId).eq('lesson',lesson).maybeSingle();
 if(lockError||lock?.locked!==false)return fail(403,'LESSON_LOCKED','선생님이 아직 열지 않은 차시예요.');
 if(action==='activity:project:get'){
  const {data,error}=await db.from('sb_projects').select('building_name,reason,description,layer_notes,blocks,version,submitted').eq('student_id',student.studentId).eq('class_id',student.classId).maybeSingle();
  return error?fail(500,'LOAD_FAILED','설계를 불러오지 못했습니다.'):ok({building:data});
 }
 if(action==='activity:project:save'){
  const building=body.building as Building;
  if(!building||!validBuilding(building,building.submitted)||!Number.isInteger(building.version))return fail(400,'INVALID_BUILDING','건축물 이름, 설계 이유, 3개 층의 설명과 3층 모양을 확인해 주세요.');
  const {data,error}=await db.rpc('sb_save_building',{p_student:student.studentId,p_class:student.classId,p_version:building.version,p_data:{...building,blocks:canonicalize(building.blocks)}});
  return error?fail(error.message.includes('VERSION_CONFLICT')?409:500,'SAVE_CONFLICT','다른 창에서 수정했거나 저장에 실패했습니다. 기기 기록을 보관했습니다. 서버 상태를 다시 확인해 주세요.'):ok({version:data});
 }
 if(action==='activity:challenge:create'){
  const blocks=body.blocks as BlockCoord[],type=String(body.type);
  if(!validChallenge(blocks,type))return fail(400,'TEN_BLOCKS','쌓기나무를 정확히 10개 사용해 주세요.');
  const code=generateShareCode();
  const {error}=await db.from('sb_shared_challenges').insert({class_id:student.classId,author_id:student.studentId,share_code:code,challenge_type:type,blocks:canonicalize(blocks),grid_width:5,grid_depth:5,max_height:3});
  return error?fail(500,'SAVE_FAILED','문제 저장에 실패했습니다. 다시 시도해 주세요.'):ok({code});
 }
 if(action==='activity:challenge:get'||action==='activity:challenge:hint'||action==='activity:challenge:attempt'){
  const {data:c,error}=await db.from('sb_shared_challenges').select('*').eq('share_code',text(body.code,12).toUpperCase()).eq('class_id',student.classId).maybeSingle();
  if(error||!c)return fail(404,'NOT_FOUND','우리 반 문제 코드를 확인해 주세요.');
  const {data:prior}=await db.from('sb_challenge_solves').select('*').eq('challenge_id',c.id).eq('student_id',student.studentId).maybeSingle();
  const state={wrongCount:prior?.wrong_count??0,hintShown:prior?.used_hint??false,answerRevealed:prior?.answer_revealed??false,completed:prior?.correct??false,score:prior?.score??0};
  const given=challengeGiven(c.blocks,c.challenge_type as ChallengeType);
  if(action==='activity:challenge:get')return ok({given,state,answer:state.answerRevealed?c.blocks:null});
  if(action==='activity:challenge:hint'){
   if(state.completed)return ok({state,hint:'이미 완료한 문제예요.'});
   const hinted={...state,hintShown:true};
   const {error:hintError}=await db.rpc('sb_submit_challenge',{p_student:student.studentId,p_challenge:c.id,p_previous:state.wrongCount,p_state:{...hinted,xp:0,score:0}});
   if(hintError)return fail(409,'SAVE_FAILED','힌트를 저장하지 못했습니다. 다시 시도해 주세요.');
   return ok({state:hinted,hint:'각 자리의 높이와 보이지 않는 블록을 차례로 살펴보세요.'});
  }
  const blocks=body.blocks as BlockCoord[];
  if(!validStructure(blocks,ACTIVITY_GRID))return fail(400,'INVALID_BLOCKS','블록 위치를 확인해 주세요.');
  const correct=grade({problemType:'BUILD_FROM_VIEWS',gradingMode:c.challenge_type==='views'?'constraint':'exact',answer:{kind:'blocks',blocks:c.blocks},submission:{kind:'blocks',blocks},given,grid:ACTIVITY_GRID}).correct&&blocks.length===10;
  const outcome=applyAttempt(state,correct);
  const score=challengeScore(outcome.state.hintShown,outcome.state.answerRevealed,outcome.state.completed);
  const {error:saveError}=await db.rpc('sb_submit_challenge',{p_student:student.studentId,p_challenge:c.id,p_previous:state.wrongCount,p_state:{...outcome.state,xp:outcome.xpEarned,score}});
  if(saveError)return fail(409,'SAVE_FAILED','시도를 저장하지 못했습니다. 문제를 다시 열어 주세요.');
  return ok({outcome,state:{...outcome.state,score},answer:outcome.state.answerRevealed?c.blocks:null,hint:outcome.state.hintShown?'각 자리의 높이와 보이지 않는 블록을 차례로 살펴보세요.':null,score});
 }
 if(action==='activity:review:save'){
  const confidence=Number(body.confidence);
  if(![1,2,3].includes(confidence))return fail(400,'BAD_VALUE','자기평가를 선택해 주세요.');
  const {error}=await db.from('sb_self_evaluations').upsert({student_id:student.studentId,confidence,reflection:text(body.reflection,1000)});
  return error?fail(500,'SAVE_FAILED','저장하지 못했습니다.'):ok({saved:true});
 }
 return fail(400,'BAD_ACTION','지원하지 않는 활동입니다.');
}
