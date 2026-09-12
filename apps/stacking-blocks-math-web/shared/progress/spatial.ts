import type { AnswerState, ConceptTag, Face, Problem } from '../problems/contracts/spatial.ts';
import type { BlockCoord } from '../types.ts';
import { commonProblems, adaptiveProblems, practiceProblems, LESSON3_MODEL } from '../problems/templates/lesson3.ts';
import { type LearningAttempt, initialAttempt } from '../problems/grading/spatial.ts';
export interface ActivityState {views:Face[];top:boolean[][];inspected:Face[];mapping:Record<string,string>;compared:boolean;prediction:Face[];predictionConfirmed:boolean;blocks:BlockCoord[];history:BlockCoord[][];future:BlockCoord[][];changeCompared:boolean;}
export interface LessonState {version:'spatial-v2';seed:number;section:'learn'|'solve'|'practice';activity:number;learnComplete:boolean;activities:Record<number,ActivityState>;solveIndex:number;practiceIndex:number;practiceCount:number;adaptive:Problem[]|null;answers:Record<string,AnswerState>;attempts:Record<string,LearningAttempt>;}
export function initialActivity():ActivityState {return {views:[],top:Array.from({length:3},()=>[false,false,false]),inspected:[],mapping:{},compared:false,prediction:[],predictionConfirmed:false,blocks:structuredClone(LESSON3_MODEL),history:[],future:[],changeCompared:false};}
export function initialLesson(seed:number):LessonState {return {version:'spatial-v2',seed,section:'learn',activity:0,learnComplete:false,activities:{},solveIndex:0,practiceIndex:0,practiceCount:5,adaptive:null,answers:{},attempts:{}};}
export function solveProblems(s:LessonState):Problem[] {return [...commonProblems(s.seed),...(s.adaptive??[])];}
export function ensureAdaptive(s:LessonState):LessonState {
 if(s.adaptive)return s;
 const common=commonProblems(s.seed);if(!common.every(p=>s.attempts[p.id]?.completed))return s;
 const errors:Partial<Record<ConceptTag,number>>={};
 for(const p of common)for(const t of p.conceptTags)errors[t]=(errors[t]??0)+(s.attempts[p.id]??initialAttempt()).wrong;
 return {...s,adaptive:adaptiveProblems(s.seed,errors)};
}
export function activeProblem(s:LessonState):Problem|undefined {return s.section==='solve'?solveProblems(s)[s.solveIndex]:s.section==='practice'?practiceProblems(s.seed,s.practiceCount)[s.practiceIndex]:undefined;}
/** Versioned serialized local progress. Old curriculum records are never read or rewritten. */
export function restoreLesson(raw:string|null):LessonState|null {
 try {const value=JSON.parse(raw??'null') as LessonState|null;
 if(!value||value.version!=='spatial-v2'||!Number.isInteger(value.seed)||!['learn','solve','practice'].includes(value.section)||!Number.isInteger(value.activity)||value.activity<0||value.activity>5||!Number.isInteger(value.solveIndex)||value.solveIndex<0||value.solveIndex>9||!Number.isInteger(value.practiceIndex)||value.practiceIndex<0||value.practiceIndex>9||![5,10].includes(value.practiceCount)||!value.answers||!value.attempts||!value.activities)return null;
 return value;}catch{return null;}
}
export function localProgressKey(url:string,installationId:string,studentId:string,classId:string){return `spatial-v2:${encodeURIComponent(url)}:${installationId}:${classId}:${studentId}:lesson3`;}
