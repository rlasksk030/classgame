import { ACTIVITY_GRID, challengeGiven, validBuilding, validChallenge, type Building, type ChallengeType } from '../../../shared/activities.ts';
import { canonicalize, validStructure } from '../../../shared/blocks.ts';
import { systemChallengeRows, challengeCard, challengeCorrect, solveState, type ChallengeRow } from './challenge-bank.ts';
import { applyAttempt } from '../../../shared/attempts.ts';
import type { BlockCoord } from '../../../shared/types.ts';
import { sanitizeAppearance, sanitizeTheme, type RewardMaterial, type RewardTheme } from '../../../shared/rewards.ts';
import { generateShareCode } from './security.ts';
import { fail,ok,text } from './http.ts';
import type { serviceClient } from './db.ts';
export async function activityRequest(db:ReturnType<typeof serviceClient>, body:Record<string,unknown>, student:{studentId:string;classId:string}) {
 const action=String(body.action);
 const lesson=action.includes('challenge')?9:action.includes('review')?12:body.lesson===11?11:10;
 const {data:lock,error:lockError}=await db.from('sb_lesson_settings').select('locked').eq('class_id',student.classId).eq('lesson',lesson).maybeSingle();
 if(lockError||lock?.locked!==false)return fail(403,'LESSON_LOCKED','선생님이 아직 열지 않은 차시예요.');
 if(action==='activity:project:get'){
 const {data,error}=await db.from('sb_projects').select('building_name,reason,description,layer_notes,blocks,block_appearance,intro_theme,version,submitted,grid_width,grid_depth,max_height').eq('student_id',student.studentId).eq('class_id',student.classId).maybeSingle();
  return error?fail(500,'LOAD_FAILED','설계를 불러오지 못했습니다.'):ok({building:data});
 }
 if(action==='activity:project:save'){
  const building=body.building as Building;
  if(building?.submitted&&lesson!==11)return fail(400,'SUBMIT_ON_LESSON_11','소개서 완성은 11차시에서 할 수 있습니다.');
  if(!building||!validBuilding(building,building.submitted)||!Number.isInteger(building.version))return fail(400,'INVALID_BUILDING','건축물 이름, 설계 이유, 3개 층의 설명과 3층 모양을 확인해 주세요.');
  const appearance = sanitizeAppearance((building as Building & { block_appearance?: unknown }).block_appearance);
  const { data: rewardRow } = await db.from('sb_student_rewards').select('total_xp').eq('student_id', student.studentId).maybeSingle();
  const xp = Number(rewardRow?.total_xp ?? 0);
  for (const key of Object.keys(appearance)) {
    const value = appearance[key];
    if ((value === 'pastel' && xp < 50) || (value === 'brick' && xp < 150) || (value === 'tile' && xp < 300)) appearance[key] = 'wood';
  }
  const theme = sanitizeTheme((building as Building & { intro_theme?: unknown }).intro_theme);
  const {data,error}=await db.rpc('sb_save_building',{p_student:student.studentId,p_class:student.classId,p_version:building.version,p_data:{...building,blocks:canonicalize(building.blocks),block_appearance:appearance,intro_theme:theme}});
  return error?fail(error.message.includes('VERSION_CONFLICT')?409:500,'SAVE_CONFLICT','다른 창에서 수정했거나 저장에 실패했습니다. 기기 기록을 보관했습니다. 서버 상태를 다시 확인해 주세요.'):ok({version:data});
 }
 if(action==='activity:challenge:list'){
  const {data:rows,error}=await db.from('sb_shared_challenges').select('*').eq('class_id',student.classId).order('created_at',{ascending:false}).limit(500);
  const {data:solves,error:solveError}=await db.from('sb_challenge_solves').select('challenge_id,correct').eq('student_id',student.studentId);
  if(error||solveError)return fail(500,'CHALLENGE_LIST_FAILED','문제 목록을 불러오지 못했습니다.');
  const peers=(rows??[]).filter(c=>c.source!=='system'&&c.author_id!==student.studentId);
  let system:ChallengeRow[]=[];
  if(peers.filter(c=>!solves?.some(s=>s.challenge_id===c.id&&s.correct)).length<3){
   system=await systemChallengeRows(student.classId);
   const {error:bankError}=await db.from('sb_shared_challenges').upsert(system,{onConflict:'id',ignoreDuplicates:true});
   if(bankError)return fail(500,'CHALLENGE_BANK_UNAVAILABLE','기본 연습 문제를 준비하지 못했습니다.');
   const {data:stored,error:storedError}=await db.from('sb_shared_challenges').select('*').eq('class_id',student.classId).eq('source','system');
   if(storedError)return fail(500,'CHALLENGE_BANK_UNAVAILABLE','기본 연습 문제를 불러오지 못했습니다.');
   const ordered=system.map(c=>stored?.find(row=>row.id===c.id));
   if(ordered.some(c=>!c))return fail(500,'CHALLENGE_BANK_UNAVAILABLE','기본 연습 문제를 확인하지 못했습니다.');
   system=ordered as ChallengeRow[];
  }
  const completed=(id:string)=>Boolean(solves?.some(s=>s.challenge_id===id&&s.correct));
  const ordered=(items:ChallengeRow[])=>items.sort((a,b)=>Number(completed(a.id))-Number(completed(b.id))).map(c=>challengeCard(c,completed(c.id)));
  return ok({challenges:[...ordered(peers),...ordered(system)]});
 }
 if(action==='activity:challenge:create'){
  const blocks=body.blocks as BlockCoord[],type=String(body.type),hintType=['views','top','heightMap','layers'].includes(String(body.hintType))?String(body.hintType):'heightMap';
  if(!validChallenge(blocks,type))return fail(400,'TEN_BLOCKS','쌓기나무를 정확히 10개 사용해 주세요.');
  const code=generateShareCode();
  const {error}=await db.from('sb_shared_challenges').insert({class_id:student.classId,author_id:student.studentId,share_code:code,challenge_type:type,hint_type:hintType,blocks:canonicalize(blocks),grid_width:5,grid_depth:5,max_height:3,source:'student'});
  return error?fail(500,'SAVE_FAILED','문제 저장에 실패했습니다. 다시 시도해 주세요.'):ok({code});
 }
 if(action==='activity:challenge:get'||action==='activity:challenge:hint'||action==='activity:challenge:attempt'){
  const {data:c,error}=await db.from('sb_shared_challenges').select('*').eq('share_code',text(body.code,12).toUpperCase()).eq('class_id',student.classId).maybeSingle();
  if(error||!c)return fail(404,'NOT_FOUND','우리 반 문제 코드를 확인해 주세요.');
  if(c.author_id===student.studentId)return fail(403,'OWN_CHALLENGE','내 문제는 점수를 받을 수 없어요. 친구 문제를 골라 주세요.');
  const {data:prior,error:priorError}=await db.from('sb_challenge_solves').select('*').eq('challenge_id',c.id).eq('student_id',student.studentId).maybeSingle();
  if(priorError)return fail(500,'ATTEMPT_LOAD_FAILED','풀이 기록을 불러오지 못했습니다.');
  const state=solveState(prior);
  const given=challengeGiven(c.blocks,c.challenge_type as ChallengeType);
  const hintGiven=state.hintShown?challengeGiven(c.blocks,(c.hint_type as ChallengeType)??'heightMap'):undefined;
  if(action==='activity:challenge:get')return ok({given,state,...(state.answerRevealed?{revealedAnswer:c.blocks}:{}),hintGiven});
  if(action==='activity:challenge:hint'){
   if(state.completed)return ok({state,hint:'이미 완료한 문제예요.'});
   const hinted={...state,hintShown:true};
   const {data:savedHint,error:hintError}=await db.rpc('sb_submit_challenge_v2',{p_student:student.studentId,p_challenge:c.id,p_previous:state.wrongCount,p_state:{...hinted,expectedHintShown:state.hintShown}});
   if(hintError)return fail(409,'SAVE_FAILED','힌트를 저장하지 못했습니다. 다시 시도해 주세요.');
   return ok({state:solveState(savedHint.state),hint:'각 자리의 높이와 보이지 않는 블록을 차례로 살펴보세요.',hintGiven:challengeGiven(c.blocks,(c.hint_type as ChallengeType)??'heightMap')});
  }
  const blocks=body.blocks as BlockCoord[];
  if(!validStructure(blocks,ACTIVITY_GRID))return fail(400,'INVALID_BLOCKS','블록 위치를 확인해 주세요.');
  const correct=challengeCorrect(c as ChallengeRow,blocks,state.hintShown);
  const outcome=applyAttempt(state,correct);
  const {data:saved,error:saveError}=await db.rpc('sb_submit_challenge_v2',{p_student:student.studentId,p_challenge:c.id,p_previous:state.wrongCount,p_state:{...outcome.state,expectedHintShown:state.hintShown}});
  if(saveError)return fail(409,'SAVE_FAILED','시도를 저장하지 못했습니다. 문제를 다시 열어 주세요.');
  const final=solveState(saved.state);
  return ok({outcome:{...outcome,state:final,xpEarned:0,stars:0},state:final,...(final.answerRevealed?{revealedAnswer:c.blocks}:{}),hintGiven:final.hintShown?challengeGiven(c.blocks,(c.hint_type as ChallengeType)??'heightMap'):undefined,score:final.score});
 }
 if(action==='activity:review:save'){
  const confidence=Number(body.confidence);
  if(![1,2,3].includes(confidence))return fail(400,'BAD_VALUE','자기평가를 선택해 주세요.');
  const {error}=await db.from('sb_self_evaluations').upsert({student_id:student.studentId,confidence,reflection:text(body.reflection,1000)});
  return error?fail(500,'SAVE_FAILED','저장하지 못했습니다.'):ok({saved:true});
 }
 return fail(400,'BAD_ACTION','지원하지 않는 활동입니다.');
}
