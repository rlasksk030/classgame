/** Read-only catalog snapshot from 2026-10-02; no remote student rows. */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import type { activityRequest } from '../../supabase/functions/_shared/activities.ts';

export const liveSchema = JSON.parse(readFileSync(new URL('../fixtures/live-v4-schema.json', import.meta.url), 'utf8'));
export const compatibilitySql = () => readFileSync('supabase/migrations/20261002104459_live_v4_compatibility.sql', 'utf8');
const identifier = (s: string) => '"' + s.replaceAll('"', '""') + '"';

export async function liveV4Db() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to anon,authenticated,service_role;`);
  for (const table of liveSchema.tables) {
    const columns = liveSchema.columns.filter((c: {table:string}) => c.table === table.name);
    await db.exec(`create table public.${identifier(table.name)} (${columns.map((c: {name:string;type:string;nullable:string;default:string|null}) =>
      `${identifier(c.name)} ${c.type} ${c.nullable === 'NO' ? 'not null' : ''} ${c.default ? 'default ' + c.default : ''}`).join(',')});`);
  }
  // Unique keys precede all foreign keys, regardless of table name ordering.
  for (const constraint of [...liveSchema.constraints].sort((a,b) => Number(a.type==='f')-Number(b.type==='f'))) {
    await db.exec(`alter table public.${identifier(constraint.table)} add constraint ${identifier(constraint.name)} ${constraint.definition};`);
  }
  for (const index of liveSchema.indexes) {
    if (!liveSchema.constraints.some((c: {name:string}) => c.name === index.name)) await db.exec(index.definition);
  }
  for (const fn of liveSchema.functions) {
    await db.exec(fn.definition);
    await db.exec(`revoke all on function public.${identifier(fn.name)}(${fn.signature}) from public,anon,authenticated,service_role;`);
    for (const role of ['anon','authenticated','service_role']) if (fn[role]) {
      await db.exec(`grant execute on function public.${identifier(fn.name)}(${fn.signature}) to ${role};`);
    }
  }
  for (const table of liveSchema.tables) if (table.rls) await db.exec(`alter table public.${identifier(table.name)} enable row level security;`);
  for (const p of liveSchema.policies) await db.exec(`create policy ${identifier(p.policyname)} on public.${identifier(p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.join(',')} ${p.qual ? 'using ('+p.qual+')' : ''} ${p.with_check ? 'with check ('+p.with_check+')' : ''};`);
  for (const t of liveSchema.triggers) await db.exec(t.definition);
  for (const g of liveSchema.grants) await db.exec(`grant ${g.privilege} on public.${identifier(g.table)} to ${g.role};`);
  return db;
}

/** Small PostgREST transport adapter; SQL and production activity handler are real. */
export function activityClient(db: PGlite): Parameters<typeof activityRequest>[0] {
  return {
    from(table: string) {
      const filters: [string, unknown][]=[];
      let columns='*';
      const query={select(value:string){columns=value;return query;},eq(column:string,value:unknown){filters.push([column,value]);return query;},async maybeSingle(){
        const selected=columns==='*'?'*':columns.split(',').map(identifier).join(',');
        const result=await db.query(`select ${selected} from ${identifier(table)} where ${filters.map(([key],i)=>`${identifier(key)}=$${i+1}`).join(' and ')}`,filters.map(([,value])=>value));
        return {data:result.rows[0]??null,error:null};
      }};
      return query;
    },
    async rpc(name:string,args:Record<string,unknown>){
      try {
        const result=await db.query(`select ${identifier(name)}(${Object.keys(args).map((key,i)=>`${identifier(key)}:=$${i+1}`).join(',')}) result`,Object.values(args));
        return {data:result.rows[0].result,error:null};
      } catch(error) { return {data:null,error:{message:String(error)}}; }
    },
  } as unknown as Parameters<typeof activityRequest>[0];
}
