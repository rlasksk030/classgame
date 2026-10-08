import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { catalogFingerprints, type Catalog } from './database-state.ts';
import { classifyPermissionDifference, expectedPermissionProfile, type PermissionSnapshot } from './permission-audit.ts';
import { identifier, literal } from './legacy-sql.ts';
import type { InstallerPlan } from './orchestrator.ts';
import type { LegacyTransition } from './legacy-generation.ts';
import { permissionRoleContextMatches } from './hosted-role-proof.ts';

export type PermissionRecoveryReason = 'NO_PERMISSION_DRIFT' | 'UNSAFE_STRUCTURE' | 'UNKNOWN_PERMISSION_CONTEXT' | 'UNSUPPORTED_ACL' | 'BASELINE_MISMATCH' | 'HISTORY_MISMATCH';
export interface PermissionChange { object: string; kind: 'table' | 'function'; action: 'GRANT' | 'REVOKE'; role: string; privileges: string[] }
interface TrustedObject { kind: 'table' | 'function'; name: string; arguments?: string; owner: string; acl: string[] | null }
interface RecoveryBaseline { migrationHashes: string[]; profiles: Record<string, { objects: Record<string, TrustedObject> }> }
export type PermissionRecovery = { recoverable: false; reason: PermissionRecoveryReason } | {
  recoverable: true; profile: string; changes: PermissionChange[]; query: string; fingerprint: string; normalizedCatalog: Catalog;
};
const roles = ['anon', 'authenticated', 'service_role', 'postgres'];
const codes: Record<string, string> = { a: 'INSERT', r: 'SELECT', w: 'UPDATE', d: 'DELETE', D: 'TRUNCATE', x: 'REFERENCES', t: 'TRIGGER', m: 'MAINTAIN', X: 'EXECUTE' };
const stable = (value: unknown): string => JSON.stringify(sort(value));
function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,sort(v)]));
  return value;
}
const equal = (a: unknown, b: unknown): boolean => stable(a) === stable(b);
const deny = (reason: PermissionRecoveryReason): PermissionRecovery => ({ recoverable: false, reason });
const hash = (value: unknown): string => createHash('sha256').update(stable(value)).digest('hex');
const objectKey = (kind: 'table' | 'function', row: Record<string, unknown>): string => `${kind === 'table' ? 'tables' : 'rpcs'}::${row.name}:${row.arguments ?? ''}`;

/** Only known, unquoted role names and the baseline owner may appear in ACLs.
 * Grant options/foreign grantors require a separate review, never CASCADE. */
function aclRights(object: TrustedObject, acl: unknown): Record<string, string[]> | undefined {
  if (object.owner !== 'postgres') return undefined;
  const all = object.kind === 'table' ? 'arwdDxtm' : 'X';
  const raw = acl === null ? [`postgres=${all}/postgres`, ...(object.kind === 'function' ? ['=X/postgres'] : [])] : acl;
  if (!Array.isArray(raw)) return undefined;
  const result: Record<string, string[]> = {};
  for (const item of raw) {
    if (typeof item !== 'string') return undefined;
    const match = /^(|anon|authenticated|service_role|postgres)=([arwdDxtmX]*)\/postgres$/.exec(item);
    if (!match || [...match[2]].some(code => !all.includes(code))) return undefined;
    const role = match[1] || 'PUBLIC';
    if (Object.hasOwn(result, role) || new Set(match[2]).size !== match[2].length) return undefined;
    result[role] = [...match[2]].map(code => codes[code]).sort();
  }
  return result;
}

interface Candidate { profile: string; objects: Record<string, TrustedObject>; normalizedCatalog: Catalog; expected: Omit<PermissionSnapshot, 'defaultPrivileges'> }
function candidates(plan: InstallerPlan, catalog: Catalog): Candidate[] {
  const hashes = plan.migrations.map(m => createHash('sha256').update(m.query).digest('hex'));
  if (!plan.databaseBaseline || JSON.stringify(hashes) !== JSON.stringify(plan.databaseBaseline.migrationHashes)) return [];
  const trusted: RecoveryBaseline = JSON.parse(readFileSync(new URL('./permission-recovery-baseline.json', import.meta.url), 'utf8'));
  if (JSON.stringify(hashes) !== JSON.stringify(trusted.migrationHashes)) return [];
  return plan.databaseBaseline.profiles.flatMap(profile => {
    const objects = trusted.profiles[profile.name]?.objects;
    const expected = expectedPermissionProfile(profile.name, hashes);
    if (!objects || !expected) return [];
    const normalizedCatalog = structuredClone(catalog);
    for (const kind of ['table','function'] as const) {
      const section = kind === 'table' ? 'tables' : 'rpcs';
      if (!Array.isArray(normalizedCatalog[section])) return [];
      for (const row of normalizedCatalog[section]) {
        const object = objects[objectKey(kind,row)];
        if (!object || object.kind !== kind || row.name !== object.name || (row.arguments ?? '') !== (object.arguments ?? '')) return [];
        row.acl = structuredClone(object.acl);
      }
    }
    // Every structure, RLS expression, RPC body/security/search_path and column
    // ACL must match. Only the exact object ACL field can differ.
    if (!equal(catalogFingerprints(normalizedCatalog), profile.objects)) return [];
    return [{ profile: profile.name, objects, normalizedCatalog, expected }];
  }).sort((a,b) => plan.databaseBaseline!.profiles.find(p => p.name === b.profile)!.prefix - plan.databaseBaseline!.profiles.find(p => p.name === a.profile)!.prefix);
}

function contextMatches(candidate: Candidate, actual: PermissionSnapshot): boolean {
  if (!actual || !equal(actual.schema, candidate.expected.schema) || !Array.isArray(actual.defaultPrivileges) || !actual.objects || !actual.roles || !equal(Object.keys(actual.objects), Object.keys(candidate.expected.objects)) || !equal(Object.keys(actual.roles), roles)) return false;
  return permissionRoleContextMatches(actual.roles,candidate.expected.roles,actual.executorGraph);
}

/** Read-only equivalence: direct PUBLIC rights must also agree, not just the
 * four sampled roles. No ACL string-only acceptance or data-evidence bypass. */
export function normalizeEquivalentCatalog(plan: InstallerPlan, catalog: Catalog, permissions: unknown): Catalog | undefined {
  try {
    for (const candidate of candidates(plan,catalog)) {
      const actual = permissions as PermissionSnapshot;
      if (!contextMatches(candidate,actual) || !equal(actual.objects,candidate.expected.objects)) continue;
      let equivalent = true;
      for (const kind of ['table','function'] as const) for (const row of catalog[kind === 'table' ? 'tables' : 'rpcs']) {
        const object = candidate.objects[objectKey(kind,row)];
        const current = aclRights(object,row.acl), expected = aclRights(object,object.acl);
        if (!current || !expected || !equal(current,expected)) equivalent = false;
      }
      if (equivalent) return candidate.normalizedCatalog;
    }
  } catch { /* Unknown catalogs stay blocked. No remote fields in errors. */ }
  return undefined;
}

/** Server-only planner. HTTP owns project/session/OAuth binding, expiry and
 * explicit consent. Never execute a browser-supplied query or change list. */
export function buildPermissionRecovery(plan: InstallerPlan, history: string[], catalog: Catalog, permissions: unknown): PermissionRecovery {
  try {
    const possible = candidates(plan,catalog);
    if (!possible.length) return deny('UNSAFE_STRUCTURE');
    const candidate = possible.find(c => {
      const profile = plan.databaseBaseline!.profiles.find(p => p.name === c.profile)!;
      const prefix = new Set(plan.migrations.slice(0,profile.prefix).map(m => m.name));
      // Manual installs can lack migration bookkeeping. Exact catalog and data
      // evidence are separately required; never invent historical rows here.
      return profile.name.startsWith('history-prefix-') && history.every(name => prefix.has(name)) && history.length === new Set(history).size;
    });
    if (!candidate) return deny('HISTORY_MISMATCH');
    const actual = permissions as PermissionSnapshot;
    if (!contextMatches(candidate,actual)) return deny('UNKNOWN_PERMISSION_CONTEXT');
    const changes: PermissionChange[] = [];
    const statements: string[] = [];
    for (const kind of ['table','function'] as const) for (const row of catalog[kind === 'table' ? 'tables' : 'rpcs']) {
      const key = objectKey(kind,row), object = candidate.objects[key];
      const category = classifyPermissionDifference({ profile:candidate.profile, key, migrationHashes:plan.databaseBaseline!.migrationHashes, actual, structural:false });
      if (category === 'E_UNKNOWN' || category === 'D_STRUCTURAL_CHANGE') return deny('UNKNOWN_PERMISSION_CONTEXT');
      const current = aclRights(object,row.acl), expected = aclRights(object,object.acl);
      if (!current || !expected || !equal(current.postgres,expected.postgres)) return deny('UNSUPPORTED_ACL');
      // An A classification only covers sampled roles. A changed PUBLIC grant
      // can affect other users, so it cannot be "proven equivalent" here.
      if (category === 'A_EQUIVALENT' && !equal(current.PUBLIC ?? [],expected.PUBLIC ?? [])) return deny('UNKNOWN_PERMISSION_CONTEXT');
      const name = `public.${identifier(object.name)}${kind === 'function' ? `(${object.arguments})` : ''}`;
      for (const role of ['PUBLIC','anon','authenticated','service_role']) for (const action of ['REVOKE','GRANT'] as const) {
        const from = action === 'REVOKE' ? current : expected, to = action === 'REVOKE' ? expected : current;
        const rights = (from[role] ?? []).filter(p => !(to[role] ?? []).includes(p));
        if (!rights.length) continue;
        changes.push({ object: `${object.name}${kind === 'function' ? `(${object.arguments})` : ''}`, kind, action, role, privileges:rights });
        statements.push(`${action} ${rights.join(',')} ON ${kind.toUpperCase()} ${name} ${action === 'GRANT' ? 'TO' : 'FROM'} ${role === 'PUBLIC' ? 'PUBLIC' : identifier(role)};`);
      }
    }
    if (!changes.length) return deny('NO_PERMISSION_DRIFT');
    const query = recoveryTransaction(catalog,actual,candidate.expected,statements);
    return { recoverable:true,profile:candidate.profile,changes,query,fingerprint:hash({profile:candidate.profile,history,catalog,permissions,changes,query}),normalizedCatalog:candidate.normalizedCatalog };
  } catch { return deny('BASELINE_MISMATCH'); }
}

/** A latest-release data-only resume may follow an approved ACL repair. SQL
 * GRANT/REVOKE cannot restore PostgreSQL's NULL ACL representation. Canonicalize
 * that representation only inside the existing digest query, after proving
 * both direct and effective permissions and pinning them before/after the
 * transaction. Never use this wrapper for a schema-changing transition. */
export function prepareEquivalentLegacyTransition(plan: InstallerPlan, transition: LegacyTransition, catalog: Catalog, permissions: unknown): string | undefined {
  try {
    const known = plan.legacyRecovery?.transitions.find(t => t.from === transition.from && t.to === transition.to && t.query === transition.query);
    const profile = plan.databaseBaseline?.profiles.find(p => p.name === transition.from);
    if (!known || transition.from !== transition.to || profile?.kind !== 'RELEASE' || profile.prefix !== plan.migrations.length) return undefined;
    const normalized = normalizeEquivalentCatalog(plan,catalog,permissions);
    if (!normalized || !equal(catalogFingerprints(normalized),profile.objects)) return undefined;
    const candidate = candidates(plan,catalog).find(c => c.profile === profile.name);
    if (!candidate) return undefined;
    const catalogQuery = readFileSync(new URL('./catalog.sql', import.meta.url),'utf8').trim().replace(/;$/,'');
    const permissionQuery = readFileSync(new URL('./permission-audit.sql', import.meta.url),'utf8').trim().replace(/;$/,'');
    // Both pre/post digest checks must be present exactly once each. The
    // reviewed transition is immutable; there is no generic SQL replacement.
    if (transition.query.split(catalogQuery).length !== 3 || !/\nlock table [^\n]+;\n/.test(transition.query) || !transition.query.endsWith('\ncommit;')) return undefined;
    const aclMap = literal(JSON.stringify(Object.fromEntries(Object.entries(candidate.objects).map(([key,obj]) => [key,obj.acl]))));
    const canonicalQuery = `select jsonb_object_agg(e.key,case when e.key in ('tables','rpcs') then (select coalesce(jsonb_agg(jsonb_set(v.value,'{acl}',${aclMap}::jsonb->(e.key||'::'||(v.value->>'name')||':'||coalesce(v.value->>'arguments',''))) order by ordinal),'[]'::jsonb) from jsonb_array_elements(e.value) with ordinality v(value,ordinal)) else e.value end) snapshot from (${catalogQuery}) raw, lateral jsonb_each(raw.snapshot) e`;
    const guard = `do $acl_legacy$ begin
if current_user <> 'postgres' then raise exception 'INSTALLER_PERMISSION_EXECUTOR_INVALID'; end if;
if (select snapshot from (${catalogQuery}) c) is distinct from (select catalog from pg_temp.sb_acl_legacy_expected) then raise exception 'INSTALLER_PERMISSION_PLAN_STALE'; end if;
if (select snapshot from (${permissionQuery}) p) is distinct from (select permissions from pg_temp.sb_acl_legacy_expected) then raise exception 'INSTALLER_PERMISSION_PLAN_STALE'; end if;
end $acl_legacy$;`;
    const before = `set local standard_conforming_strings=on;
create temporary table sb_acl_legacy_expected on commit drop as select ${literal(JSON.stringify(catalog))}::jsonb catalog,${literal(JSON.stringify(permissions))}::jsonb permissions;
${guard}`;
    return transition.query.replaceAll(catalogQuery,()=>canonicalQuery)
      .replace(/\nlock table [^\n]+;\n/,match=>`${match}${before}\n`)
      .replace(/\ncommit;$/,()=>`\n${guard}\ncommit;`);
  } catch { return undefined; }
}

function recoveryTransaction(catalog: Catalog, actual: PermissionSnapshot, expected: Candidate['expected'], statements: string[]): string {
  const catalogQuery = readFileSync(new URL('./catalog.sql', import.meta.url),'utf8').trim().replace(/;$/,'');
  const permissionsQuery = readFileSync(new URL('./permission-audit.sql', import.meta.url),'utf8').trim().replace(/;$/,'');
  const tables = catalog.tables.map(row => String(row.name)).sort();
  const snapshot = tables.map(name => `select ${literal(name)} table_name,to_jsonb(t) row_data from public.${identifier(name)} t`).join('\nunion all\n');
  const expectedPermissions = { ...actual, objects:expected.objects };
  const withoutAcls = (source: string) => `(select jsonb_object_agg(e.key,case when e.key in ('tables','rpcs') then (select coalesce(jsonb_agg(v.value-'acl'),'[]'::jsonb) from jsonb_array_elements(e.value) v) else e.value end) from jsonb_each(${source}) e)`;
  return `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL standard_conforming_strings=on;
DO $acl_guard$ BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'INSTALLER_PERMISSION_EXECUTOR_INVALID'; END IF;
END $acl_guard$;
SELECT pg_advisory_xact_lock(hashtext('stacking-blocks-math:permission-recovery'));
LOCK TABLE ${tables.map(name => `public.${identifier(name)}`).join(',')} IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMPORARY TABLE sb_acl_recovery_expected ON COMMIT DROP AS SELECT ${literal(JSON.stringify(catalog))}::jsonb catalog,${literal(JSON.stringify(actual))}::jsonb permissions,${literal(JSON.stringify(expectedPermissions))}::jsonb expected_permissions;
DO $acl_guard$ BEGIN
  IF (SELECT snapshot FROM (${catalogQuery}) c) IS DISTINCT FROM (SELECT catalog FROM pg_temp.sb_acl_recovery_expected) THEN RAISE EXCEPTION 'INSTALLER_PERMISSION_PLAN_STALE'; END IF;
  IF (SELECT snapshot FROM (${permissionsQuery}) p) IS DISTINCT FROM (SELECT permissions FROM pg_temp.sb_acl_recovery_expected) THEN RAISE EXCEPTION 'INSTALLER_PERMISSION_PLAN_STALE'; END IF;
END $acl_guard$;
CREATE TEMPORARY TABLE sb_acl_recovery_rows ON COMMIT DROP AS ${snapshot};
CREATE TEMPORARY TABLE sb_acl_recovery_defaults ON COMMIT DROP AS SELECT to_jsonb(d) row_data FROM pg_default_acl d;
${statements.join('\n')}
DO $acl_guard$ BEGIN
  IF (SELECT snapshot FROM (${permissionsQuery}) p) IS DISTINCT FROM (SELECT expected_permissions FROM pg_temp.sb_acl_recovery_expected) THEN RAISE EXCEPTION 'INSTALLER_PERMISSION_POSTCHECK_FAILED'; END IF;
  IF ${withoutAcls(`(SELECT snapshot FROM (${catalogQuery}) c)`)} IS DISTINCT FROM ${withoutAcls('(SELECT catalog FROM pg_temp.sb_acl_recovery_expected)')} THEN RAISE EXCEPTION 'INSTALLER_PERMISSION_STRUCTURE_CHANGED'; END IF;
  IF EXISTS((SELECT row_data FROM pg_temp.sb_acl_recovery_defaults EXCEPT ALL SELECT to_jsonb(d) FROM pg_default_acl d) UNION ALL (SELECT to_jsonb(d) FROM pg_default_acl d EXCEPT ALL SELECT row_data FROM pg_temp.sb_acl_recovery_defaults)) THEN RAISE EXCEPTION 'INSTALLER_PERMISSION_DEFAULTS_CHANGED'; END IF;
  IF EXISTS((SELECT * FROM pg_temp.sb_acl_recovery_rows EXCEPT ALL (${snapshot})) UNION ALL ((${snapshot}) EXCEPT ALL SELECT * FROM pg_temp.sb_acl_recovery_rows)) THEN RAISE EXCEPTION 'INSTALLER_DATA_PRESERVATION_FAILED'; END IF;
END $acl_guard$;
COMMIT;`;
}
