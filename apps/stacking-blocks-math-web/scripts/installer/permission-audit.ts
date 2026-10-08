import { readFileSync } from 'node:fs';

/** A-E are diagnostic categories only. Even A never permits an installation. */
export type PermissionCategory = 'A_EQUIVALENT' | 'B_BROADER_PERMISSION' | 'C_MISSING_PERMISSION' | 'D_STRUCTURAL_CHANGE' | 'E_UNKNOWN';
export interface PermissionObject {
  owner: string; otherGrantees: number;
  roles: Record<string, { privileges: string[]; grantOptions: string[] }>;
}
export interface PermissionSnapshot {
  roles: Record<string, { superuser: boolean; bypassRls: boolean; inherit: boolean; memberships: number }>;
  schema: { owner: string; usage: Record<string, boolean>; create: Record<string, boolean> };
  defaultPrivileges: unknown[];
  objects: Record<string, PermissionObject>;
}
interface PermissionBaseline {
  migrationHashes: string[];
  models: Record<string, PermissionObject>;
  profiles: Record<string, { roles: PermissionSnapshot['roles']; schema: PermissionSnapshot['schema']; objects: Record<string, string> }>;
}
const baseline: PermissionBaseline = JSON.parse(readFileSync(new URL('./permission-baseline.json', import.meta.url), 'utf8'));
const roles = ['anon','authenticated','service_role','postgres'];
const privileges = ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN','EXECUTE'];
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
function validObject(value: unknown): value is PermissionObject {
  if (!isObject(value) || !['postgres','supabase_admin','OTHER'].includes(String(value.owner)) || !Number.isSafeInteger(value.otherGrantees) || Number(value.otherGrantees) < 0 || !isObject(value.roles)) return false;
  return roles.every(role => {
    const item = value.roles[role];
    return isObject(item) && ['privileges','grantOptions'].every(k => Array.isArray(item[k]) && item[k].every(p => typeof p === 'string' && privileges.includes(p)));
  });
}
/** Return fixed enums only; no remote names, SQL, role identifiers or ACL text. */
export function classifyPermissionDifference(input: {
  profile: string; key: string; migrationHashes: string[]; structural: boolean; actual: unknown;
}): PermissionCategory {
  if (input.structural) return 'D_STRUCTURAL_CHANGE';
  const expected = baseline.profiles[input.profile];
  if (!expected || JSON.stringify(input.migrationHashes) !== JSON.stringify(baseline.migrationHashes) || !isObject(input.actual) || !isObject(input.actual.objects) || !isObject(input.actual.roles) || !isObject(input.actual.schema) || !isObject(input.actual.schema.usage) || !isObject(input.actual.schema.create) || input.actual.schema.owner !== expected.schema.owner) return 'E_UNKNOWN';
  const old = baseline.models[expected.objects[input.key]], actual = input.actual.objects[input.key];
  if (!old || !validObject(actual) || actual.owner !== old.owner || actual.otherGrantees !== old.otherGrantees) return 'E_UNKNOWN';
  let broader = false, missing = false;
  for (const role of roles) {
    const context = input.actual.roles[role];
    // A nonzero count alone cannot prove identical membership edges. Do not
    // infer equivalence for any inherited-role graph we have not modeled.
    if (!isObject(context) || context.memberships !== 0 || typeof input.actual.schema.usage[role] !== 'boolean' || typeof input.actual.schema.create[role] !== 'boolean') return 'E_UNKNOWN';
    // Hosted postgres need not be superuser. Its effective object rights below
    // still apply; application-role flags/membership changes need separate review.
    if (role !== 'postgres' && ['superuser','bypassRls','inherit','memberships'].some(k => context[k] !== expected.roles[role][k as keyof PermissionSnapshot['roles'][string]])) return 'E_UNKNOWN';
    broader ||= input.actual.schema.usage[role] === true && !expected.schema.usage[role];
    missing ||= input.actual.schema.usage[role] === false && expected.schema.usage[role];
    broader ||= input.actual.schema.create[role] === true && !expected.schema.create[role];
    missing ||= input.actual.schema.create[role] === false && expected.schema.create[role];
    for (const field of ['privileges','grantOptions'] as const) {
      broader ||= actual.roles[role][field].some(p => !old.roles[role][field].includes(p));
      missing ||= old.roles[role][field].some(p => !actual.roles[role][field].includes(p));
    }
  }
  return broader && missing ? 'E_UNKNOWN' : broader ? 'B_BROADER_PERMISSION' : missing ? 'C_MISSING_PERMISSION' : 'A_EQUIVALENT';
}

/** Bounded safe context for operator logs, never used to accept catalog drift. */
export function permissionContext(actual: unknown): { available: boolean; schemaOwnerKnown?: boolean; defaultPrivilegeEntries?: number; applicationRoleContextChanged?: boolean } {
  if (!isObject(actual) || !isObject(actual.roles) || !isObject(actual.schema) || !Array.isArray(actual.defaultPrivileges)) return { available: false };
  const normal = baseline.profiles[`history-prefix-${baseline.migrationHashes.length}`];
  return { available: true, schemaOwnerKnown: ['postgres','supabase_admin','pg_database_owner'].includes(String(actual.schema.owner)), defaultPrivilegeEntries: actual.defaultPrivileges.length,
    applicationRoleContextChanged: ['anon','authenticated','service_role'].some(role => !isObject(actual.roles[role]) || ['superuser','bypassRls','inherit','memberships'].some(k => (actual.roles[role] as Record<string,unknown>)[k] !== normal.roles[role][k as keyof PermissionSnapshot['roles'][string]])) };
}
