import { initialActivity,initialLesson,restoreLesson,type LessonState } from './spatial.ts';
import { phase2Common,phase2Adaptive,phase2Practice,phase2Model } from '../problems/templates/phase2.ts';
import { phase2Definitions,type Phase2Lesson } from '../curriculum/phase2.ts';
import type { ConceptTag } from '../problems/contracts/spatial.ts';
export { initialLesson };
export function phase2Activity(id:Phase2Lesson){return {...initialActivity(),blocks:structuredClone(phase2Model(id))};}
export function phase2Solve(id:Phase2Lesson,s:LessonState){return [...phase2Common(id,s.seed),...(s.adaptive??[])];}
export function phase2EnsureAdaptive(id:Phase2Lesson,s:LessonState){
 if(s.adaptive)return s;const common=phase2Common(id,s.seed);if(!common.every(p=>s.attempts[p.id]?.completed))return s;
 const errors:Partial<Record<ConceptTag,number>>={};for(const p of common)for(const t of p.conceptTags)errors[t]=(errors[t]??0)+(s.attempts[p.id]?.wrong??0);
 return {...s,adaptive:phase2Adaptive(id,s.seed,errors)};
}
export function phase2Restore(id:Phase2Lesson,raw:string|null){const s=restoreLesson(raw);if(!s||s.activity>phase2Definitions[id].activities.length||s.solveIndex>=6+phase2Definitions[id].assessment.adaptiveCount||s.practiceCount!==5||s.practiceIndex>=5||s.adaptive?.some(p=>p.lessonId!==id))return null;return s;}
export function phase2Active(id:Phase2Lesson,s:LessonState){return (s.section==='solve'?phase2Solve(id,s):phase2Practice(id,s.seed))[s.section==='solve'?s.solveIndex:s.practiceIndex];}
