import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generatePracticeProblems } from '../shared/practiceGenerator.ts';
import { auditPracticeSet, generateValidatedPracticeSet, taskFingerprint } from '../shared/practiceSet.ts';

const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const at=new Date().toISOString();
const path=`qa/practice-sets/${at.replace(/[:.]/g,'-')}`;
mkdirSync(path,{recursive:true});
const seed=123;
const before=generatePracticeProblems(5,35,seed,1), after=generateValidatedPracticeSet(5,35,seed);
const rows=(set:typeof before)=>set.map((p,i)=>({order:i+1,problemId:p.code,templateId:p.templateId,seed:p.seed,generatorVersion:p.generatorVersion,
  prompt:p.prompt,given:p.given,answerInput:p.answer.kind,taskFingerprint:taskFingerprint(p),screenProblemId:null,screenStatus:'BLOCKED'}));
const otherLessons=[1,2,3,4,5,6,7,8,12].flatMap(lesson=>[5,10,15,20].map(count=>{
  const result=auditPracticeSet(generateValidatedPracticeSet(lesson,count,seed));
  return {lesson,count,category:'LOCAL_LOGIC',actualAssignmentCount:null,...result,status:result.longestRun>=3?'NEEDS_FAMILY_REVIEW':'LOCAL_CONTENT_CHECK_PASS',screenMismatches:null};
}));
const report={head,workingTree:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim(),at,category:'LOCAL_LOGIC',seed,
  liveSet:{status:'BLOCKED',rows:[],reason:'신고된 35문항 실제 API 응답·세션·배정 설정 미확보; 합성 표는 운영 세트가 아님'},
  before:{...auditPracticeSet(before),rows:rows(before)},after:{...auditPracticeSet(after),rows:rows(after)},otherLessons,
  browser:{executed:0,status:'BLOCKED',screenshots:[],reason:'기존 포트 제한 재시도하지 않음. qa:local T14 실행 대기'},
  sourcePdf:{status:'BLOCKED',reason:'검색한 workspace/attachments에서 5차시 원자료 PDF 미발견'}};
writeFileSync(`${path}/report.json`,JSON.stringify(report,null,2));
writeFileSync(`${path}/comparison.md`,[
  `# 5차시 합성 세트 전후 비교`, `실행: ${at}; HEAD ${head} + 보고서의 workingTree 변경. 실제 운영 35문항 아님.`,
  `이전 고유 ${report.before.uniqueTasks}/35 → 새 버전 ${report.after.uniqueTasks}/35. 화면 검사는 0건, BLOCKED.`,
  '|순서|이전 template|새 template|새 ID|새 seed|화면|','|---|---|---|---|---|---|',
  ...after.map((p,i)=>`|${i+1}|${before[i]?.templateId}|${p.templateId}|${p.code}|${p.seed}|BLOCKED|`),
  '\n다른 차시의 자료 고유성과 학습 행동 다양성은 별개다. 2·3·6차시의 동일 입력 행동 편중은 미해결. 원자료 적합성, 실제 시점/Scene 일치, 운영 세트 복구·보상 유지 관통은 미검증.',
].join('\n'));
console.log(path);
