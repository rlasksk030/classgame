import { generatePracticeProblems, type GeneratedProblem } from './practiceGenerator.ts';
import { taskFingerprint } from './practiceTask.ts';
export { taskFingerprint } from './practiceTask.ts';

/** 공개 생성 문항의 안정 ID. 재시도/동시 요청도 PK 충돌로 같은 문항을 재사용한다. */
export async function generatedProblemId(code:string):Promise<string> {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`stacking-generated-v2:${code}`));
  const h=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-8${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}

export function auditPracticeSet(set: GeneratedProblem[]) {
  const seen = new Map<string, number>();
  const duplicates: Array<{index:number; original:number}> = [];
  const families: Record<string,number> = {};
  let previous = '', run=0, longestRun=0;
  set.forEach((p,index) => {
    const key=taskFingerprint(p); const original=seen.get(key);
    if(original !== undefined) duplicates.push({index:index+1,original}); else seen.set(key,index+1);
    const family=p.lesson===5 ? p.templateId : p.problemType;
    families[family]=(families[family]??0)+1;
    run=family===previous?run+1:1; previous=family; longestRun=Math.max(longestRun,run);
  });
  return {count:set.length,uniqueTasks:seen.size,families,duplicates,longestRun};
}

/** 기존 v1은 보존하고 새 세트만 별도 version/ID로 생성한다. */
export function generateValidatedPracticeSet(lesson:number,count:number,seed:number):GeneratedProblem[] {
  if (!Number.isInteger(count) || count<1 || count>100 || ![1,2,3,4,5,6,7,8,12].includes(lesson)) throw new Error('PRACTICE_SET_UNSUPPORTED');
  const result:GeneratedProblem[]=[]; const seen=new Set<string>();
  for(let slot=0;slot<count;slot++) {
    let accepted=false;
    for(let attempt=0;attempt<256;attempt++) {
      const candidateSeed=(seed+Math.imul(attempt,104729))>>>0;
      const candidate=generatePracticeProblems(lesson,slot+1,candidateSeed,2).find(p=>p.orderIndex===100+slot);
      if(!candidate) continue;
      const signature=taskFingerprint(candidate);
      if(seen.has(signature)) continue;
      candidate.code=`GEN-L${lesson}-S${seed}-${String(slot+1).padStart(2,'0')}-V2`;
      result.push(candidate); seen.add(signature); accepted=true; break;
    }
    if(!accepted) throw new Error('PRACTICE_SET_INSUFFICIENT');
  }
  return result;
}

/** 조회·새 문항 삽입 여부와 무관하게 현재 학생 세트만 반환한다. */
export function selectPracticeRows<T extends {code?:string|null}>(rows:T[],lesson:number,seed:number):T[] {
  return rows.filter(row=>isAssignedPracticeCode(row.code,lesson,seed));
}

export function isAssignedPracticeCode(code:string|null|undefined,lesson:number,seed:number):boolean {
  return !String(code??'').startsWith('GEN-L') || String(code).startsWith(`GEN-L${lesson}-S${seed}-`);
}

/** 진단만 수행한다. 기존 문항/답안/XP를 변경하거나 중복 행을 삭제하지 않는다. */
export function practiceSetStatus<T extends {code?:string|null;order_index:number}>(rows:T[],lesson:number,seed:number,targetCount:number,displayedSeed=seed) {
  const generated=rows.filter(row=>String(row.code??'').startsWith(`GEN-L${lesson}-S${displayedSeed}-`));
  const duplicateCodes=generated.length-new Set(generated.map(row=>row.code)).size;
  const legacy=lesson===5&&generated.some(row=>!row.code?.endsWith('-V2'));
  return { contractVersion:2 as const, seed, displayedSeed, awaitingReplacement:displayedSeed!==seed, targetCount, generatedCount:generated.length,
    supplementalCount:rows.filter(row=>!String(row.code??'').startsWith('GEN-L')&&row.order_index>2).length,
    duplicateCodes, legacyVersion:legacy, requiresRepair:duplicateCodes>0||displayedSeed!==seed };
}

/** 구 API가 seed만 바꾼 뒤 옛 세트를 반환했던 경우, 명시적 재시작 전까지 화면을 보존한다. */
export function practiceDisplaySeed(rows:{code?:string|null}[],lesson:number,savedSeed:number,originalSeed:number):number {
  const has=(seed:number)=>rows.some(row=>String(row.code??'').startsWith(`GEN-L${lesson}-S${seed}-`));
  return !has(savedSeed)&&has(originalSeed)?originalSeed:savedSeed;
}
