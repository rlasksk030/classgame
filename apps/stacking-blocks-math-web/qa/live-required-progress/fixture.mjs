/* global URL */
// Rebuild ONLY actual-use catalog. No historical migration replay, no remote rows.
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
export const catalog=JSON.parse(readFileSync(new URL('./evidence/current-catalog.json',import.meta.url),'utf8'));
export const id=s=>'"'+s.replaceAll('"','""')+'"';
const perms={a:'INSERT',r:'SELECT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN',X:'EXECUTE'};
export async function createFixture(){
 const db=new PGlite();
 // Auth is an isolated, synthetic provider stub; no real auth.users SQL is sent.
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to anon,authenticated,service_role;`);
 for(const t of catalog.tables){const cols=catalog.columns.filter(c=>c.table===t.name);await db.exec(`create table public.${id(t.name)} (${cols.map(c=>`${id(c.name)} ${c.type==='text[]'?'text[]':c.type==='\u005ftext'?'text[]':c.type==='\u005fint4'?'int4[]':c.type} ${c.nullable==='NO'?'not null':''} ${c.default?'default '+c.default:''}`).join(',')})`);}
 for(const c of catalog.constraints.filter(c=>c.type!=='f'))await db.exec(`alter table public.${id(c.table)} add constraint ${id(c.name)} ${c.definition}`);
 for(const x of catalog.indexes)if(!catalog.constraints.some(c=>c.name===x.name))await db.exec(x.definition);
 for(const c of catalog.constraints.filter(c=>c.type==='f'))await db.exec(`alter table public.${id(c.table)} add constraint ${id(c.name)} ${c.definition}`);
 for(const f of catalog.rpc_definitions)await db.exec(f.definition);
 for(const f of catalog.rpcs){
  if(f.acl!==null){await db.exec(`revoke all on function public.${id(f.name)}(${f.arguments}) from public,anon,authenticated,service_role`);await applyAcl(db,'function',`public.${id(f.name)}(${f.arguments})`,f.acl);}
 }
 for(const t of catalog.tables){
  if(t.rls)await db.exec(`alter table public.${id(t.name)} enable row level security`);
  if(t.force_rls)await db.exec(`alter table public.${id(t.name)} force row level security`);
  if(t.acl)await applyAcl(db,'table',`public.${id(t.name)}`,t.acl);
 }
 for(const p of catalog.policies){const mode=catalog.policy_modes.find(x=>x.table===p.table&&x.name===p.name)?.permissive??'PERMISSIVE';await db.exec(`create policy ${id(p.name)} on public.${id(p.table)} as ${mode} for ${p.command} to ${p.roles.map(x=>x==='public'?'public':id(x)).join(',')} ${p.using?'using ('+p.using+')':''} ${p.check?'with check ('+p.check+')':''}`);}
 for(const c of catalog.column_acls){for(const acl of c.acl){const {role,letters}=parseAcl(acl);for(const p of letters)await db.exec(`grant ${perms[p]} (${id(c.column)}) on public.${id(c.table)} to ${id(role)}`);}}
 for(const t of catalog.triggers){await db.exec(t.definition);if(t.enabled==='D')await db.exec(`alter table public.${id(t.table)} disable trigger ${id(t.name)}`);}
 return db;
}
function parseAcl(acl){const [role,rest]=acl.split('=');return {role:role||'public',letters:rest.split('/')[0].replaceAll('*','')}};
async function applyAcl(db,kind,object,acls){for(const acl of acls){const {role,letters}=parseAcl(acl);if(role==='postgres')continue;for(const ch of letters)await db.exec(`grant ${perms[ch]} on ${kind} ${object} to ${role==='public'?'public':id(role)}`);}}
export async function snapshot(db){const result=await db.query(readFileSync(new URL('./catalog-local-select.sql',import.meta.url),'utf8'));const s=result.rows[0].snapshot; s.constraints=s.constraints.filter(c=>c.type!=='n'); return s;}
