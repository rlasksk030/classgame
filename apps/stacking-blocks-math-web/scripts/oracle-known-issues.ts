/** Executable content gates. Archived generators are compatibility data, not the active bank. */
import { SEED_PROBLEMS } from '../shared/seedProblems.ts';
import { generatePracticeProblems, getProblemTemplates } from '../shared/practiceGenerator.ts';
import { taskFingerprint, generateValidatedPracticeSet, auditPracticeSet } from '../shared/practiceSet.ts';
import { validateCandidate } from '../oracle/validate.ts';
import { generatePeerPracticeBank } from '../shared/peerPracticeBank.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const failures:string[]=[], signatures=new Map<string,string>();
for(const p of SEED_PROBLEMS){
 const signature=JSON.stringify([p.problemType,p.grid,p.given,p.givenBlocks,p.startBlocks,p.answer,[...p.choices].sort()]);
 if(signatures.has(signature))failures.push(`FIXED_DUPLICATE:${signatures.get(signature)}:${p.code}`);
 signatures.set(signature,p.code);
 if(!validateCandidate(p).ok)failures.push(`FIXED_ORACLE:${p.code}`);
}
const choices:Record<number,number[]>={},difficulty:Record<string,number>={},families:Record<string,number>={};
let generated=0,dfsComplete=0,duplicates=0;
for(const lesson of [1,2,3,4,5,6,7,8,12]){
 const templates=getProblemTemplates(lesson,3),reached=new Set<string>();
 for(let seed=0;seed<120;seed++){
  const set=generatePracticeProblems(lesson,templates.length,seed,3);
  if(set.length!==templates.length)failures.push(`MISSING_SLOT:L${lesson}:S${seed}`);
  for(const p of set){
   generated++;reached.add(p.templateId);families[p.templateId]=(families[p.templateId]??0)+1;difficulty[p.difficultyTier]=(difficulty[p.difficultyTier]??0)+1;
   const validated=validateCandidate(p);
   if(!validated.ok)failures.push(`ORACLE:${p.code}:${validated.issues.map(i=>i.field)}`);
   if(validated.dfsResult&&!validated.dfsResult.capped)dfsComplete++;
   if(p.answer.kind==='choice'){
    const counts=choices[p.choices.length]??Array<number>(p.choices.length).fill(0);counts[p.answer.index]++;choices[p.choices.length]=counts;
   }
   if(p.templateId==='lesson6-minimum'||p.templateId==='lesson6-maximum'){
    if(p.answer.kind!=='count'||!p.given.reasoning||!/최소|최대/.test(p.prompt))failures.push(`UNREACHABLE_MIN_MAX:${p.code}`);
   }
  }
 }
 for(const t of templates)if(!reached.has(t.templateId))failures.push(`UNREACHABLE:${t.templateId}`);
}
for(const lesson of [5,6,12])for(const seed of [0,1,42,123,7919,603756])for(const n of [5,20,35]){
 const audit=auditPracticeSet(generateValidatedPracticeSet(lesson,n,seed));duplicates+=audit.duplicates.length;
 if(audit.uniqueTasks!==n)failures.push(`DUPLICATE:L${lesson}:S${seed}:${n}`);
 if(audit.longestRun>2)failures.push(`TYPE_RUN:L${lesson}:${audit.longestRun}`);
}
// Compare within choice arity: binary judgments are not expected to have four answer positions.
for(const [arity,counts]of Object.entries(choices)){
 const total=counts.reduce((a,b)=>a+b,0),expected=total/Number(arity);
 if(total>=100&&counts.some(n=>Math.abs(n-expected)>expected*0.3))failures.push(`CHOICE_POSITION_BIAS:${arity}`);
}
const peers=generatePeerPracticeBank();
if(new Set(peers.map(p=>JSON.stringify(p.card))).size!==24)failures.push('PEER_DUPLICATE');
// A hidden-model/ID/choice-order change must not manufacture a new task.
const p=generatePracticeProblems(5,1,42,3)[0];
if(taskFingerprint(p)!==taskFingerprint({...p,code:'other',seed:99,choices:[...p.choices].reverse(),givenBlocks:[{x:0,y:0,z:0}]}))failures.push('FINGERPRINT_PRIVATE_DATA');
const report={generatedAt:new Date().toISOString(),generatorVersion:3,seeds:'0..119',fixed:SEED_PROBLEMS.length,generated,peerBank:peers.length,dfsComplete,duplicates,choices,difficulty,families,failures};
mkdirSync('oracle/reports',{recursive:true});
writeFileSync('oracle/reports/known-issues-report.json',JSON.stringify(report,null,2));
writeFileSync('oracle/reports/known-issues-report.md',`# Content regression gates\n\n${failures.length?'FAIL':'PASS'}\n\n\`\`\`json\n${JSON.stringify(report,null,2)}\n\`\`\`\n`);
console.log(JSON.stringify(report,null,2));
if(failures.length)process.exitCode=1;
