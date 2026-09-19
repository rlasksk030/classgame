/** Playwright-only transport. Real activity handler + PostgreSQL RPC; synthetic auth/lesson records. */
import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {activityRequest} from '../../supabase/functions/_shared/activities.ts';
import {SEED_PROBLEMS} from '../../shared/seedProblems.ts';
import {deriveProblemPresentation} from '../../shared/problemPresentation.ts';
import {grade} from '../../shared/grading.ts';
import {applyAttempt,INITIAL_ATTEMPT} from '../../shared/attempts.ts';
import type {StudentSubmission} from '../../shared/types.ts';

type Row=Record<string,unknown>;
export const CLASS='33333333-3333-4333-8333-333333333333';
export const STUDENTS=['55555555-5555-4555-8555-555555555551','55555555-5555-4555-8555-555555555552','55555555-5555-4555-8555-555555555553'];
export const SYNTHETIC_PIN='4826';
export async function liveApi(){
 const pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`);
 for(const f of readdirSync('supabase/migrations').sort())await pg.exec(readFileSync(`supabase/migrations/${f}`,'utf8').replace('create extension if not exists "pgcrypto";',''));
 await pg.exec(`insert into auth.users values('11111111-1111-4111-8111-111111111111');insert into sb_classes(id,teacher_id,name,class_code) values('${CLASS}','11111111-1111-4111-8111-111111111111','합성 QA반','QAONLY');`);
 for(const [i,id] of STUDENTS.entries())await pg.query('insert into sb_students(id,class_id,name,pin_hash) values($1,$2,$3,$4)',[id,CLASS,`QA학생${i+1}`,'synthetic-only']);
 for(let lesson=1;lesson<=12;lesson++)await pg.query('insert into sb_lesson_settings(class_id,lesson,locked) values($1,$2,false)',[CLASS,lesson]);
 const ident=(s:string)=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw Error('unsafe identifier');return s;};
 function table(name:string){
  const filters:Array<[string,unknown]>=[];let columns='*',order='',limit='',single=false,rows:Row[]|null=null,upsert=false,conflict='student_id',ignore=false;
  const q={select(c='*'){columns=c==='*'?'*':c.split(',').map(ident).join(',');return q;},eq(k:string,v:unknown){filters.push([ident(k),v]);return q;},order(k:string,opts:{ascending:boolean}){order=` order by ${ident(k)} ${opts.ascending?'asc':'desc'}`;return q;},limit(n:number){limit=` limit ${Number(n)}`;return q;},maybeSingle(){single=true;return q;},insert(r:Row|Row[]){rows=Array.isArray(r)?r:[r];return q;},upsert(r:Row|Row[],options?:{onConflict?:string;ignoreDuplicates?:boolean}){rows=Array.isArray(r)?r:[r];upsert=true;conflict=options?.onConflict??'student_id';ignore=Boolean(options?.ignoreDuplicates);return q;},then(resolve:(v:{data:unknown;error:unknown})=>unknown){return (async()=>{try{
   if(rows){for(const row of rows){const keys=Object.keys(row).map(ident);await pg.query(`insert into ${ident(name)}(${keys.join(',')}) values(${keys.map((_,i)=>`$${i+1}`).join(',')})${upsert?` on conflict(${ident(conflict)}) ${ignore?'do nothing':'do update set '+keys.filter(k=>k!==conflict).map(k=>`${k}=excluded.${k}`).join(',')}`:''}`,keys.map(k=>row[k]));}return resolve({data:null,error:null});}
   const where=filters.length?' where '+filters.map(([k],i)=>`${k}=$${i+1}`).join(' and '):'';
   const result=await pg.query(`select ${columns} from ${ident(name)}${where}${order}${limit}`,filters.map(([,v])=>v));
   return resolve({data:single?result.rows[0]??null:result.rows,error:null});
  }catch(e){return resolve({data:null,error:{message:String(e)}});}})();}};return q;
 }
 const db={from:table,rpc:async(name:string,args:Row)=>{try{const keys=Object.keys(args);const r=await pg.query<Row>(`select ${ident(name)}(${keys.map((k,i)=>`${ident(k)}:=$${i+1}`).join(',')}) as result`,keys.map(k=>args[k]));return {data:r.rows[0]?.result,error:null};}catch(e){return {data:null,error:{message:String(e)}};}}};
 const tokens=new Map<string,string>();
 const attempts=new Map<string,ReturnType<typeof applyAttempt>['state']>();
 const snapshots=new Map<string,unknown>();const positions=new Map<string,string>();const submissions:Row[]=[];
 const problems=SEED_PROBLEMS.filter(p=>[3,5,12].includes(p.lesson)).map(p=>({...p,id:p.code,stage:'check' as const,presentation:deriveProblemPresentation(p)}));
 const publicProblem=(p:typeof problems[number])=>{const {answer:_,hint:__,explanation:___,...dto}=p;void _;void __;void ___;return dto;};
 const response=(body:unknown,status=200)=>Response.json(body,{status});
 async function request(path:string,body:Row,token:string|undefined):Promise<Response>{
  if(path.endsWith('student-auth')){
   if(body.classCode!=='QAONLY')return response({error:{code:'CLASS_NOT_FOUND',message:'반을 찾지 못했어요.'}},404);
   if(body.action==='class')return response({className:'합성 QA반',classId:CLASS});
   const index=['QA학생1','QA학생2','QA학생3'].indexOf(String(body.name));
   if(index<0||body.pin!==SYNTHETIC_PIN)return response({error:{code:'PIN_INVALID',message:'이름과 PIN을 확인해 주세요.'}},401);
   const id=STUDENTS[index],value=Buffer.from(JSON.stringify({sid:id,cid:CLASS})).toString('base64')+'.synthetic';tokens.set(value,id);
   return response({token:value,expiresAt:'2099-01-01',student:{id,name:body.name,classId:CLASS,className:'합성 QA반'}});
  }
  const sid=tokens.get(token??'');if(!sid)return response({error:{code:'SESSION_INVALID',message:'다시 로그인해 주세요.'}},401);
  const action=String(body.action),key=`${sid}:${body.problemId}`;
  if(action.startsWith('activity:'))return activityRequest(db as unknown as Parameters<typeof activityRequest>[0],body,{studentId:sid,classId:CLASS});
  if(action==='home')return response({student:{classId:CLASS,className:'합성 QA반',rewards:{totalXp:0,totalStars:0,badges:[],streak:0},lessons:Array.from({length:12},(_,i)=>({lesson:i+1,locked:false,totalProblems:problems.filter(p=>p.lesson===i+1).length,completedProblems:problems.filter(p=>p.lesson===i+1&&attempts.get(`${sid}:${p.id}`)?.completed).length,completed:false,stars:0}))}});
  if(action==='lessonProblems'){const ps=problems.filter(p=>p.lesson===Number(body.lesson));return response({problems:ps.map(publicProblem),seedFallback:false,requiredComplete:ps.every(p=>attempts.get(`${sid}:${p.id}`)?.completed),currentProblemId:positions.get(`${sid}:${body.lesson}`)});}
  const p=problems.find(p=>p.id===body.problemId);
  if(action==='problem')return response({problem:p&&publicProblem(p),attempt:attempts.get(key)??INITIAL_ATTEMPT,hint:null,revealedAnswer:null});
  if(action==='snapshot:get')return response({snapshot:snapshots.get(key)??null});
  if(action==='snapshot'){snapshots.set(key,{blocks:body.blocks});return response({ok:true});}
  if(action==='position'){positions.set(`${sid}:${body.lesson}`,String(body.problemId));return response({ok:true});}
  if(action==='attempt'&&p){submissions.push(body);const correct=grade({...p,submission:body.submission as StudentSubmission}).correct;const outcome=applyAttempt(attempts.get(key)??INITIAL_ATTEMPT,correct);attempts.set(key,outcome.state);return response({grade:{correct,...outcome.state,message:outcome.message,xpEarned:outcome.xpEarned,stars:outcome.stars,hint:outcome.sendHint?p.hint:null,revealedAnswer:null}});}
  return response({error:{code:'MOCK_UNHANDLED',message:action}},400);
 }
 return {request,submissions,pg,close:()=>pg.close()};
}
