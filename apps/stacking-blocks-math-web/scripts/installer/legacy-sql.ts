/** Server-only SQL helpers. Inputs are checked-in catalogs, never browser data. */
import type { Catalog } from './database-state.ts';

export const identifier = (s: unknown): string => '"' + String(s).replaceAll('"', '""') + '"';
export const literal = (s: unknown): string => "'" + String(s).replaceAll("'", "''") + "'";
const key = (r: Record<string, unknown>) => `${r.table ?? ''}:${r.name ?? r.column ?? ''}:${r.arguments ?? ''}`;
const normalized = (r: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'position').sort()));
const type = (t: unknown) => String(t).startsWith('_') ? String(t).slice(1) + '[]' : String(t);
const column = (r: Record<string, unknown>) => `${identifier(r.name)} ${type(r.type)}${r.default ? ` default ${r.default}` : ''}${r.nullable === 'NO' ? ' not null' : ''}`;
const privileges: Record<string, string> = { a: 'insert', r: 'select', w: 'update', d: 'delete', D: 'truncate', x: 'references', t: 'trigger', X: 'execute', m: 'maintain' };
function grants(kind: string, object: string, acl: unknown): string[] {
  if (!Array.isArray(acl)) return [];
  return acl.flatMap(item => {
    const [role, rest] = String(item).split('=');
    if (role === 'postgres') return [];
    if (rest.includes('*')) throw new Error('UNREVIEWED_GRANT_OPTION');
    return [...rest.split('/')[0]].map(p => `grant ${privileges[p]} on ${kind} ${object} to ${role ? identifier(role) : 'public'};`);
  });
}

/** Offline compiler: only exact known source/target pairs are packaged. No generic
 * remote schema repair. Removed tables/columns or type conversions fail generation. */
export function schemaDelta(from: Catalog, to: Catalog): string {
  const sql: string[] = [];
  const old = (section: string, row: Record<string, unknown>) => from[section].find(r => key(r) === key(row));
  const changed = (section: string, row: Record<string, unknown>) => normalized(old(section, row) ?? {}) !== normalized(row);
  for (const section of ['tables', 'columns']) for (const r of from[section]) {
    if (!to[section].some(t => key(t) === key(r))) throw new Error(`DESTRUCTIVE_DELTA:${section}:${key(r)}`);
  }
  // Drop only known replaced constraint/index/trigger/policy definitions; never rows.
  for (const section of ['triggers', 'policies', 'constraints', 'indexes']) for (const r of from[section]) {
    if (section === 'constraints' && r.type === 'n') continue;
    if (section === 'indexes' && from.constraints.some(c => c.table === r.table && c.name === r.name)) continue;
    const next = to[section].find(t => key(t) === key(r));
    if (!next || normalized(r) !== normalized(next)) sql.push(section === 'constraints' ? `alter table public.${identifier(r.table)} drop constraint ${identifier(r.name)};` : section === 'indexes' ? `drop index public.${identifier(r.name)};` : `drop ${section === 'triggers' ? 'trigger' : 'policy'} ${identifier(r.name)} on public.${identifier(r.table)};`);
  }
  for (const t of to.tables) if (!old('tables', t)) sql.push(`create table public.${identifier(t.name)} (${to.columns.filter(c => c.table === t.name).map(column).join(',')});`);
  for (const c of to.columns) {
    if (!from.tables.some(t => t.name === c.table)) continue;
    const prev = old('columns', c);
    const obj = `alter table public.${identifier(c.table)}`;
    if (!prev) sql.push(`${obj} add column ${column(c)};`);
    else {
      if (prev.type !== c.type) throw new Error(`UNREVIEWED_TYPE_CHANGE:${key(c)}`);
      if (prev.default !== c.default) sql.push(`${obj} alter column ${identifier(c.name)} ${c.default ? `set default ${c.default}` : 'drop default'};`);
      if (prev.nullable !== c.nullable) sql.push(`${obj} alter column ${identifier(c.name)} ${c.nullable === 'NO' ? 'set' : 'drop'} not null;`);
    }
  }
  for (const f of to.rpc_definitions) if (changed('rpc_definitions', f)) sql.push(String(f.definition).trim().replace(/;$/, '') + ';');
  for (const c of to.constraints.filter(c => !['f', 'n'].includes(String(c.type)))) if (changed('constraints', c)) sql.push(`alter table public.${identifier(c.table)} add constraint ${identifier(c.name)} ${c.definition};`);
  for (const i of to.indexes) if (!to.constraints.some(c => c.table === i.table && c.name === i.name) && changed('indexes', i)) sql.push(`${i.definition};`);
  for (const c of to.constraints.filter(c => c.type === 'f')) if (changed('constraints', c)) sql.push(`alter table public.${identifier(c.table)} add constraint ${identifier(c.name)} ${c.definition};`);
  for (const t of to.tables) {
    const prev = old('tables', t);
    if (!prev || prev.rls !== t.rls) sql.push(`alter table public.${identifier(t.name)} ${t.rls ? 'enable' : 'disable'} row level security;`);
    if (t.force_rls && !prev?.force_rls) sql.push(`alter table public.${identifier(t.name)} force row level security;`);
    if (JSON.stringify(prev?.acl) !== JSON.stringify(t.acl)) sql.push(`revoke all on table public.${identifier(t.name)} from public,anon,authenticated,service_role;`, ...grants('table', `public.${identifier(t.name)}`, t.acl));
  }
  for (const f of to.rpcs) if (JSON.stringify(old('rpcs', f)?.acl) !== JSON.stringify(f.acl)) {
    const object = `public.${identifier(f.name)}(${f.arguments})`;
    // A null ACL means PostgreSQL's public EXECUTE default.
    if (f.acl !== null) sql.push(`revoke all on function ${object} from public,anon,authenticated,service_role;`, ...grants('function', object, f.acl));
  }
  for (const p of to.policies) if (changed('policies', p)) sql.push(`create policy ${identifier(p.name)} on public.${identifier(p.table)} as ${to.policy_modes.find(m => key(m) === key(p))?.permissive ?? 'PERMISSIVE'} for ${p.command} to ${(p.roles as string[]).map(identifier).join(',')} ${p.using ? `using (${p.using})` : ''} ${p.check ? `with check (${p.check})` : ''};`);
  for (const c of to.column_acls) if (changed('column_acls', c) || JSON.stringify(from.tables.find(t => t.name === c.table)?.acl) !== JSON.stringify(to.tables.find(t => t.name === c.table)?.acl)) {
    for (const acl of c.acl as string[]) {
      const [role, rest] = acl.split('=');
      for (const p of rest.split('/')[0]) sql.push(`grant ${privileges[p]} (${identifier(c.column)}) on public.${identifier(c.table)} to ${identifier(role)};`);
    }
  }
  for (const t of to.triggers) if (changed('triggers', t)) sql.push(`${t.definition};`, ...(t.enabled === 'D' ? [`alter table public.${identifier(t.table)} disable trigger ${identifier(t.name)};`] : []));
  return sql.join('\n');
}

/** PG17/18-independent digest; remove physical column order and PG18's duplicate
 * NOT NULL constraint metadata. All remaining definitions/ACLs are compared. */
export function catalogDigestQuery(catalogQuery: string): string {
  return `select md5(jsonb_object_agg(k, v)::text) as digest from (
    select entry.key k, coalesce(jsonb_agg(normalized.row order by normalized.row::text) filter(where item.value is not null and not(entry.key='constraints' and item.value->>'type'='n')), '[]'::jsonb) v
    from (${catalogQuery.trim().replace(/;$/, '')}) snapshot_source,
    lateral jsonb_each(snapshot_source.snapshot) entry
    left join lateral jsonb_array_elements(entry.value) item on true
    left join lateral (select jsonb_object_agg(field.key,case when jsonb_typeof(field.value)='array' then (select coalesce(jsonb_agg(a.value order by a.value::text),'[]') from jsonb_array_elements(field.value) a) else field.value end) row from jsonb_each(case when entry.key='columns' then item.value-'position' else item.value end) field) normalized on true
    group by entry.key) normalized_catalog`;
}

export const PROTECTED_TABLES = ['sb_classes', 'sb_students', 'sb_student_pin_vault', 'sb_problem_attempts', 'sb_student_progress', 'sb_projects', 'sb_student_sessions', 'sb_student_rewards', 'sb_shared_challenges', 'sb_challenge_solves'];

/** DB-local hashes only, never return private rows to the installer or logs. */
export function preservationGuard(from: Catalog): { before: string; after: string } {
  const before = ['create temporary table sb_install_preservation(table_name text, identity jsonb, fingerprint text, completed boolean) on commit drop;'];
  const after: string[] = [];
  for (const name of PROTECTED_TABLES.filter(n => from.tables.some(t => t.name === n))) {
    const pk = from.constraints.find(c => c.table === name && c.type === 'p');
    const keys = String(pk?.definition).match(/^PRIMARY KEY \((.+)\)$/)?.[1].split(',').map(s => s.trim().replaceAll('"', ''));
    if (!keys) throw new Error('PRESERVATION_KEY_MISSING');
    const cols = from.columns.filter(c => c.table === name && !(name === 'sb_student_progress' && ['completed', 'completed_at'].includes(String(c.name)))).map(c => String(c.name));
    const row = `jsonb_build_object(${cols.flatMap(c => [literal(c), `t.${identifier(c)}`]).join(',')})`;
    const identity = `jsonb_build_object(${keys.flatMap(c => [literal(c), `t.${identifier(c)}`]).join(',')})`;
    before.push(`insert into sb_install_preservation select ${literal(name)},${identity},md5(${row}::text),${name === 'sb_student_progress' ? 'completed' : 'null::boolean'} from public.${identifier(name)} t;`);
    after.push(`if exists(select 1 from sb_install_preservation b left join public.${identifier(name)} t on b.identity=${identity} where b.table_name=${literal(name)} and (md5(${row}::text) is distinct from b.fingerprint ${name === 'sb_student_progress' ? 'or (b.completed and not coalesce(t.completed,false))' : ''})) then raise exception 'INSTALLER_DATA_PRESERVATION_FAILED'; end if;`);
  }
  return { before: before.join('\n'), after: `do $preserve$ begin ${after.join('\n')} end $preserve$;` };
}
