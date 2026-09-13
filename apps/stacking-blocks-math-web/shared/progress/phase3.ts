import { initialLesson,restoreLesson,type LessonState } from './spatial.ts';
import { phase3Common,phase3Adaptive,phase3Practice,type Phase3Lesson } from '../problems/templates/phase3.ts';
import type { ConceptTag } from '../problems/contracts/spatial.ts';
export {initialLesson};
export const phase3Total=(id:Phase3Lesson)=>id<7?10:9;
export const phase3Solve=(id:Phase3Lesson,s:LessonState)=>[...phase3Common(id,s.seed),...(s.adaptive??[])];
export function phase3EnsureAdaptive(id:Phase3Lesson,s:LessonState){if(s.adaptive)return s;const common=phase3Common(id,s.seed);if(!common.every(p=>s.attempts[p.id]?.completed))return s;const errors:Partial<Record<ConceptTag,number>>={};for(const p of common)for(const t of p.conceptTags)errors[t]=(errors[t]??0)+(s.attempts[p.id]?.wrong??0);return {...s,adaptive:phase3Adaptive(id,s.seed,errors)};}
export function phase3Restore(id:Phase3Lesson,raw:string|null){const s=restoreLesson(raw);if(!s||s.solveIndex>=phase3Total(id)||s.practiceIndex>=s.practiceCount||s.adaptive?.some(p=>p.lessonId!==id||!p.id.startsWith('spatial-v2:p3:')))return null;return s;}
export const phase3Active=(id:Phase3Lesson,s:LessonState)=>(s.section==='solve'?phase3Solve(id,s):phase3Practice(id,s.seed,s.practiceCount))[s.section==='solve'?s.solveIndex:s.practiceIndex];
