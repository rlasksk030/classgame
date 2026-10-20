import { ACTIVITY_GRID, challengeGiven, validBuilding, validChallenge, type Building, type ChallengeType } from '../../../shared/activities.ts';
import { canonicalize, validStructure } from '../../../shared/blocks.ts';
import { systemChallengeRows, challengeCard, challengeCorrect, solveState, type ChallengeRow } from './challenge-bank.ts';
import { applyAttempt } from '../../../shared/attempts.ts';
import type { BlockCoord } from '../../../shared/types.ts';
import { sanitizeAppearance, sanitizeTheme, type RewardMaterial, type RewardTheme } from '../../../shared/rewards.ts';
import { generateShareCode } from './security.ts';
import { fail,ok,text } from './http.ts';
import type { serviceClient } from './db.ts';
const PROJECT_FIELDS='building_name,reason,description,layer_notes,blocks,block_appearance,intro_theme,version,submitted,grid_width,grid_depth,max_height,updated_at';
function saveError(error:{message:string;code?:string}) {
 const known:Record<string,[number,string]> = {
  VERSION_CONFLICT:[409,'다른 기기에서 수정했어요. 두 설계를 비교한 뒤 선택해 주세요.'],
  REQUEST_CONFLICT:[409,'이미 저장한 문제와 내용이 달라요. 새 문제로 만들어 주세요.'],
  LESSON_LOCKED:[403,'선생님이 아직 열지 않은 차시예요.'],
  INVALID_BUILDING:[400,'블록 위치와 사용한 층의 설명을 확인해 주세요.'],
  INVALID_CHALLENGE:[400,'10개 블록과 문제·힌트 카드를 확인해 주세요.'],
  FORBIDDEN_STUDENT:[403,'현재 학생으로 저장할 수 없어요. 다시 로그인해 주세요.'],
  NOT_FOUND:[404,'내 소개서를 찾지 못했어요.'],
  NOT_COMPLETED:[400,'소개서를 먼저 완성해 주세요.'],
 };
 for(const [code,[status,message]] of Object.entries(known)) if(error.message.includes(code)) return fail(status,code,message);
 if(error.code==='42501'||error.message.includes('permission denied'))return fail(403,'DB_PERMISSION','선생님이 연결 설정을 확인해야 해요. 내용은 기기에 보관했어요.');
 if(error.code==='PGRST202'||error.code==='42883'||error.message.includes('does not exist')) return fail(409,'UPDATE_REQUIRED','선생님이 연결하고 업데이트를 완료해야 이 기능을 사용할 수 있어요.');
 return fail(500,'SAVE_FAILED','저장하지 못했어요. 내용을 유지하고 있으니 다시 시도해 주세요');
}
async function contract(db:ReturnType<typeof serviceClient>) {
 const {data,error}=await db.rpc('sb_activity_contract');
 return !error&&data===2?2:1;
}
/** Legacy project DTO uses the same validation, lesson lock and completion path. */
export async function phase5ProjectSaveRequest(db:ReturnType<typeof serviceClient>, body:Record<string,unknown>, student:{studentId:string;classId:string}) {
 const project = {building_name:text(body.title,120),reason:text(body.reason,500),description:text(body.description,1000),layer_notes:body.layerUsageNotes??body.layerNotes??['','',''],blocks:body.blocks??[],block_appearance:body.materials??body.blockAppearance??{},intro_theme:text(body.introTheme,40)||'blueprint',grid_width:Number(body.gridWidth)||10,grid_depth:Number(body.gridDepth)||10,max_height:Number(body.maxHeight)||3,submitted:body.submitted===true};
 const lesson=body.lesson??(project.submitted?11:10);
 if(lesson!==10&&lesson!==11)return fail(400,'BAD_LESSON','건축 활동 차시를 확인해 주세요.');
 const response=await activityRequest(db,{action:'activity:project:save',lesson,building:{...project,version:Number(body.expectedVersion??body.version??0)}},student);
 if(!response.ok)return response;
 const saved=await response.json();
 return ok({projectVersion:saved.version,project});
}
export async function activityRequest(db:ReturnType<typeof serviceClient>, body:Record<string,unknown>, student:{studentId:string;classId:string}) {
 const action=String(body.action);
 const lesson=action.includes('challenge')?9:action.includes('review')?12:body.lesson===11||['activity:project:shared','activity:project:sharing'].includes(action)?11:10;
 const {data:lock,error:lockError}=await db.from('sb_lesson_settings').select('locked').eq('class_id',student.classId).eq('lesson',lesson).maybeSingle();
 if(lockError||lock?.locked!==false)return fail(403,'LESSON_LOCKED','선생님이 아직 열지 않은 차시예요.');
 if(action==='activity:project:get'){
 const {data,error}=await db.from('sb_projects').select(PROJECT_FIELDS).eq('student_id',student.studentId).eq('class_id',student.classId).maybeSingle();
  return error?fail(500,'LOAD_FAILED','설계를 불러오지 못했습니다.'):ok({building:data,activityContract:await contract(db)});
 }
 if(action==='activity:project:save'){
  const building=body.building as Building;
  if(building?.submitted&&lesson!==11)return fail(400,'SUBMIT_ON_LESSON_11','소개서 완성은 11차시에서 할 수 있습니다.');
  if(!building||!validBuilding(building,building.submitted)||!Number.isInteger(building.version))return fail(400,'INVALID_BUILDING','블록 위치, 건축물 설명과 실제 사용한 층의 설명을 확인해 주세요.');
  const appearance = sanitizeAppearance((building as Building & { block_appearance?: unknown }).block_appearance);
  const { data: rewardRow } = await db.from('sb_student_rewards').select('total_xp').eq('student_id', student.studentId).maybeSingle();
  const xp = Number(rewardRow?.total_xp ?? 0);
  for (const key of Object.keys(appearance)) {
    const value = appearance[key];
    if ((value === 'pastel' && xp < 50) || (value === 'brick' && xp < 150) || (value === 'tile' && xp < 300)) appearance[key] = 'wood';
  }
  const theme = sanitizeTheme((building as Building & { intro_theme?: unknown }).intro_theme);
  // Old clients omit appearance/theme. Let the RPC retain the stored values.
  const cosmetics = {...(building.block_appearance === undefined ? {} : {block_appearance:appearance}),...(building.intro_theme === undefined ? {} : {intro_theme:theme})};
  const {data,error}=await db.rpc('sb_save_building',{p_student:student.studentId,p_class:student.classId,p_version:building.version,p_data:{...building,progress_lesson:lesson,blocks:canonicalize(building.blocks),...cosmetics}});
  return error?saveError(error):ok({version:data});
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
 if(action==='activity:challenge:mine'){
  const {data,error}=await db.from('sb_shared_challenges').select('share_code,client_request_id,created_at,blocks,challenge_type,hint_type').eq('class_id',student.classId).eq('author_id',student.studentId).order('created_at',{ascending:false}).limit(100);
  return error?saveError(error):ok({challenges:(data??[]).map(c=>({code:c.share_code,requestId:c.client_request_id,created_at:c.created_at,blocks:c.blocks,type:c.challenge_type,hintType:c.hint_type}))});
 }
 if(action==='activity:challenge:create'){
  const blocks=body.blocks as BlockCoord[],type=String(body.type),hintType=['views','top','heightMap','layers'].includes(String(body.hintType))?String(body.hintType):'heightMap';
  if(!validChallenge(blocks,type))return fail(400,'TEN_BLOCKS','쌓기나무를 정확히 10개 사용해 주세요.');
  if(body.requestId!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body.requestId)))return fail(400,'BAD_REQUEST_ID','문제를 다시 열어 주세요.');
  // The stable client request key survives response loss/reload. Legacy clients
  // without one retain their existing create operation, with collision retry.
  for(let attempt=0;attempt<5;attempt++){
   const code=generateShareCode();
   const result=body.requestId
    ? await db.rpc('sb_create_challenge',{p_student:student.studentId,p_class:student.classId,p_request:body.requestId,p_code:code,p_blocks:canonicalize(blocks),p_type:type,p_hint:hintType})
    : await db.from('sb_shared_challenges').insert({class_id:student.classId,author_id:student.studentId,share_code:code,challenge_type:type,hint_type:hintType,blocks:canonicalize(blocks),grid_width:5,grid_depth:5,max_height:3,source:'student'});
   if(!result.error)return ok(body.requestId?result.data:{code});
   if(result.error.code==='23505'||result.error.message.includes('duplicate key'))continue;
   return saveError(result.error);
  }
  return fail(503,'CODE_RETRY','코드를 만들지 못했어요. 내용을 유지하고 다시 시도해 주세요.');
 }
 if(action==='activity:project:share'){
  if(lesson!==11||typeof body.enable!=='boolean'||!Number.isInteger(body.version))return fail(400,'BAD_SHARE','소개서 공유 요청을 확인해 주세요.');
  const {data,error}=await db.rpc('sb_share_building',{p_student:student.studentId,p_class:student.classId,p_version:body.version,p_enable:body.enable});
  return error?saveError(error):ok({slug:data});
 }
 if(action==='activity:project:sharing'){
  const {data,error}=await db.from('sb_projects').select('share_slug,shared_version,version,submitted').eq('student_id',student.studentId).eq('class_id',student.classId).maybeSingle();
  return error?saveError(error):ok({slug:data?.submitted&&data.shared_version===data.version?data.share_slug:null});
 }
 if(action==='activity:project:shared'){
  if(!/^[a-f0-9]{32}$/.test(String(body.slug)))return fail(404,'NOT_FOUND','공유 중인 우리 반 소개서를 찾지 못했어요.');
  const {data,error}=await db.from('sb_projects').select(`${PROJECT_FIELDS},shared_version`).eq('share_slug',body.slug).eq('class_id',student.classId).eq('submitted',true).maybeSingle();
  if(error)return fail(500,'LOAD_FAILED','소개서를 불러오지 못했어요.');
  if(!data||data.version!==data.shared_version)return fail(404,'NOT_FOUND','공유가 중지됐거나 우리 반 소개서가 아니에요.');
  const {shared_version:_,...building}=data;void _;
  return ok({building});
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
  if(action==='activity:challenge:get')return ok({given,state,...(state.answerRevealed?{answer:c.blocks,revealedAnswer:c.blocks}:{}),hintGiven});
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
  return ok({outcome:{...outcome,state:final,xpEarned:0,stars:0},state:final,hint:final.hintShown?'각 자리의 높이와 보이지 않는 블록을 차례로 살펴보세요.':null,...(final.answerRevealed?{answer:c.blocks,revealedAnswer:c.blocks}:{}),hintGiven:final.hintShown?challengeGiven(c.blocks,(c.hint_type as ChallengeType)??'heightMap'):undefined,score:final.score});
 }
 if(action==='activity:review:get'){
  const {data,error}=await db.from('sb_self_evaluations').select('confidence,reflection').eq('student_id',student.studentId).maybeSingle();
  return error?fail(500,'LOAD_FAILED','자기평가를 불러오지 못했습니다.'):ok({evaluation:data});
 }
 if(action==='activity:review:save'){
  const confidence=Number(body.confidence);
  if(![1,2,3].includes(confidence))return fail(400,'BAD_VALUE','자기평가를 선택해 주세요.');
  const {error}=await db.from('sb_self_evaluations').upsert({student_id:student.studentId,confidence,reflection:text(body.reflection,1000)});
  return error?fail(500,'SAVE_FAILED','저장하지 못했습니다.'):ok({saved:true});
 }
 return fail(400,'BAD_ACTION','지원하지 않는 활동입니다.');
}
