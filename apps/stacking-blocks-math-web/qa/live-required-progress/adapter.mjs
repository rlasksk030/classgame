/* global console */
// Synthetic PostgREST/Auth boundary. All handler business logic is unchanged.
// SQL runs against the actual-use catalog fixture, never any remote service.
import {id} from './fixture.mjs';
const val=v=>typeof v==='object'&&v!==null?JSON.stringify(v):v;
export function client(db){return {from:t=>new Query(db,t),rpc:async(name,args)=>{try{const entries=Object.entries(args);const r=await db.query(`select public.${id(name)}(${entries.map(([k],i)=>id(k)+'=> $'+(i+1)).join(',')}) result`,entries.map(([,v])=>val(v)));return{data:r.rows[0]?.result,error:null};}catch(e){return{data:null,error:{message:e.message,code:e.code}};}}};}
class Query{
 constructor(db,t){this.db=db;this.t=t;this.filters=[];this.orders=[];this.mode='select';this.cols='*';this.params=[];}
 select(cols='*'){this.cols=cols;return this;} eq(k,v){return this.filter(k,'=',v);}gt(k,v){return this.filter(k,'>',v);}lt(k,v){return this.filter(k,'<',v);}like(k,v){return this.filter(k,'like',v);}
 filter(k,op,v){this.params.push(val(v));this.filters.push(`t.${id(k)} ${op} $${this.params.length}`);return this;}
 in(k,vs){if(!vs.length){this.filters.push('false');return this;}const p=vs.map(v=>{this.params.push(val(v));return'$'+this.params.length});this.filters.push(`t.${id(k)} in(${p})`);return this;}
 or(s){const clauses=s.split(',').map(c=>{const[k,op,...rest]=c.split('.');const v=rest.join('.');if(op==='is'&&v==='null')return`t.${id(k)} is null`;if(op!=='eq')throw Error('Unsupported synthetic OR '+s);this.params.push(v);return`t.${id(k)} = $${this.params.length}`;});this.filters.push('('+clauses.join(' or ')+')');return this;}
 order(k,o={}){this.orders.push(`t.${id(k)} ${o.ascending===false?'desc':'asc'}`);return this;}range(a,b){this.offset=a;this.max=b-a+1;return this;}limit(n){this.max=n;return this;}maybeSingle(){this.one='maybe';return this;}single(){this.one='strict';return this;}
 insert(v){this.mode='insert';this.values=Array.isArray(v)?v:[v];return this;}upsert(v,o={}){this.insert(v);this.conflict=o.onConflict;this.ignore=o.ignoreDuplicates;this.mode='upsert';return this;}update(v){this.mode='update';this.values=[v];return this;}delete(){this.mode='delete';return this;}
 then(resolve,reject){return this.run().then(resolve,reject);}
 async run(){try{let sql,params=[...this.params];const where=this.filters.length?' where '+this.filters.join(' and '):'';if(this.mode==='select'){
 let fields=this.cols.split(/,(?![^()]*\))/).map(s=>s.trim()).filter(Boolean).map(s=>{
 const m=s.match(/^sb_problems\((.*)\)$/);if(m)return`(select jsonb_build_object(${m[1].split(',').flatMap(k=>["'"+k+"'",'p.'+id(k)]).join(',')}) from public.sb_problems p where p.id=t.problem_id) sb_problems`;
 return s==='*'?'t.*':'t.'+id(s);
 });sql=`select ${fields.join(',')} from public.${id(this.t)} t${where}${this.orders.length?' order by '+this.orders.join(','):''}${this.max!==undefined?' limit '+this.max:''}${this.offset?' offset '+this.offset:''}`;
 }else if(this.mode==='update'){const set=Object.entries(this.values[0]).map(([k,v])=>{params.push(val(v));return id(k)+'=$'+params.length});sql=`update public.${id(this.t)} t set ${set.join(',')}${where} returning *`;
 }else if(this.mode==='delete'){sql=`delete from public.${id(this.t)} t${where} returning *`;
 }else{const keys=[...new Set(this.values.flatMap(Object.keys))];const rows=this.values.map(row=>'('+keys.map(k=>{if(!(k in row))return'DEFAULT';params.push(val(row[k]));return'$'+params.length;}).join(',')+')');sql=`insert into public.${id(this.t)} (${keys.map(id)}) values ${rows.join(',')}`;if(this.mode==='upsert'){const primary=(await this.db.query("select a.attname from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace cross join lateral unnest(i.indkey) with ordinality k(attnum,position) join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum where n.nspname='public' and c.relname=$1 and i.indisprimary order by k.position",[this.t])).rows.map(r=>r.attname);const conflict=this.conflict?.split(',').map(s=>s.trim())??primary;sql+=` on conflict (${conflict.map(id)}) do ${this.ignore?'nothing':'update set '+keys.filter(k=>!conflict.includes(k)).map(k=>id(k)+'=excluded.'+id(k)).join(',')}`;}sql+=' returning *';}
 const r=await this.db.query(sql,params);if(this.one&&((this.one==='strict'&&r.rows.length!==1)||r.rows.length>1))return{data:null,error:{message:'Single cardinality',code:'PGRST116'}};return{data:this.one?r.rows[0]??null:r.rows,error:null};
 }catch(e){console.error('SYNTHETIC_SQL_FAILURE',this.t,this.mode,e.message);return{data:null,error:{message:e.message,code:e.code}};}}
}
