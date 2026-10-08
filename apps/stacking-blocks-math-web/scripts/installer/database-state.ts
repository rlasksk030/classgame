import { createHash } from 'node:crypto';
import { normalizeEquivalentCatalog } from './permission-recovery.ts';
import { evidenceFields, parseDataEvidence, dataEvidenceReview, type DataEvidenceReview, type DataEvidence } from './data-evidence.ts';
export type { DataEvidence } from './data-evidence.ts';
import { InstallerError, type InstallerBackend, type InstallerTarget } from './contract.ts';
import type { InstallerPlan } from './orchestrator.ts';
import { classifyPermissionDifference, permissionContext, type PermissionCategory } from './permission-audit.ts';

export type MigrationDisposition = 'APPLIED_BY_HISTORY' | 'SATISFIED_BY_STATE' | 'PENDING' | 'DRIFT_REQUIRES_REVIEW';
export type Catalog = Record<string, Array<Record<string, unknown>>>;
export interface DatabaseBaseline {
  migrationHashes: string[];
  profiles: Array<{ name: string; kind: 'RELEASE' | 'RESUME' | 'MANUAL_DELTA_REQUIRED'; prefix: number; objects: Record<string, string>; attributes?: Record<string, Record<string, string>> }>;
}
export interface MigrationAssessment {
  recovery?: 'LEGACY_RESUME_CANDIDATE';
  evidence?: DataEvidence;
  migrations: Array<{ name: string; status: MigrationDisposition }>;
  drift: boolean;
  differences: string[];
  baseline?: string;
  /** Metadata only. Never include catalog definitions, application rows or credentials. */
  review?: {
    reason: 'KNOWN_SCHEMA_HISTORY_MISMATCH' | 'REVIEWED_DELTA_REQUIRED' | 'UNRECOGNIZED_SCHEMA' | 'DATA_EVIDENCE_REQUIRED' | 'DATA_EVIDENCE_CONFLICT';
    baseline: string;
    comparisonBaseline: string;
    permissionContext?: ReturnType<typeof permissionContext>;
    dataEvidence?: DataEvidenceReview;
    objects: Array<{ key: string; change: 'MISSING' | 'ADDITIONAL' | 'CHANGED'; category?: PermissionCategory; attributes?: Array<{ name: string; state: 'SAME' | 'DIFFERENT'; expectedDigest?: string; actualDigest?: string }> }>;
  };
}
const sections = ['tables', 'columns', 'constraints', 'indexes', 'policies', 'rpcs', 'rpc_definitions', 'triggers', 'column_acls', 'policy_modes'];
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
/** Attribute digests explain a mismatch without exposing definitions or data.
 * Object fingerprints are deliberately unchanged: a permission difference
 * must not be accepted merely because it reproduces Supabase's defaults. */
export function catalogAttributeFingerprints(catalog: Catalog): Record<string, Record<string, string>> {
  return Object.fromEntries(catalogRows(catalog).map(([key,row]) => [key, Object.fromEntries(Object.entries(row).map(([attribute,value]) => [attribute, digest(value)]))]));
}
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function catalogRows(catalog: Catalog): Array<[string, Record<string, unknown>]> {
  const rows: Array<[string, Record<string, unknown>]> = [];
  const seen = new Set<string>();
  for (const section of sections) {
    if (!Array.isArray(catalog[section])) throw manualReview();
    for (const original of catalog[section]) {
      const row = { ...original };
      if (section === 'constraints' && row.type === 'n') continue;
      if (section === 'columns') delete row.position;
      const key = `${section}:${row.table ?? ''}:${row.name ?? row.column ?? ''}:${row.arguments ?? ''}`;
      if (seen.has(key)) throw manualReview();
      seen.add(key); rows.push([key,row]);
    }
  }
  return rows;
}
export function catalogFingerprints(catalog: Catalog): Record<string, string> {
  return Object.fromEntries(catalogRows(catalog).map(([key,row]) => [key,digest(row)]));
}

function differences(expected: Record<string, string>, actual: Record<string, string>): string[] {
  return [...new Set([...Object.keys(expected), ...Object.keys(actual)])].filter(k => expected[k] !== actual[k]).sort();
}
/** Names in a remote catalog are untrusted too. Only repository-known keys
 * may be emitted verbatim; unexpected names get a stable opaque identifier. */
export function diagnosticObjectKey(key: string, baseline: DatabaseBaseline): string {
  if (baseline.profiles.some(profile => Object.hasOwn(profile.objects, key))) return key;
  const section = key.split(':')[0];
  return `${sections.includes(section) ? section : 'object'}:[unrecognized-${createHash('sha256').update(key).digest('hex').slice(0, 16)}]`;
}
export function assessDatabaseState(plan: InstallerPlan, history: string[], catalog?: Catalog, evidence?: DataEvidence): MigrationAssessment {
  const applied = new Set(history);
  if (!plan.databaseBaseline) return { drift: false, differences: [], migrations: plan.migrations.map(m => ({ name: m.name, status: applied.has(m.name) ? 'APPLIED_BY_HISTORY' : 'PENDING' })) };
  const baseline = plan.databaseBaseline;
  const hashes = plan.migrations.map(m => createHash('sha256').update(m.query).digest('hex'));
  if (JSON.stringify(hashes) !== JSON.stringify(baseline.migrationHashes) || !catalog) throw manualReview();
  const actual = catalogFingerprints(catalog);
  const actualAttributes = catalogAttributeFingerprints(catalog);
  const matches = baseline.profiles.filter(p => differences(p.objects, actual).length === 0);
  const release = matches.find(p => p.kind === 'RELEASE');
  const manual = matches.find(p => p.kind === 'MANUAL_DELTA_REQUIRED');
  const recoverySupported = Boolean(plan.legacyRecovery);
  if (recoverySupported && JSON.stringify(plan.legacyRecovery!.migrationHashes) !== JSON.stringify(hashes)) throw manualReview();
  // Prefer the highest equivalent schema prefix. Data-only purposes are checked
  // separately; catalog equality alone never proves seed/backfill execution.
  const knownSchema = matches.filter(p => p.kind === 'RESUME').sort((a,b) => b.prefix-a.prefix)[0];
  const resume = manual ? undefined : recoverySupported ? knownSchema : matches.find(p => p.kind === 'RESUME' && plan.migrations.every((m,i) => applied.has(m.name) === (i < p.prefix)));
  const selected = release ?? (recoverySupported ? manual : undefined) ?? resume;
  const historyConflict = Boolean(selected && !release && plan.migrations.some((m,i) => applied.has(m.name) && i >= selected.prefix));
  const needsEvidence = recoverySupported && Boolean(selected && selected.name !== 'fresh-empty');
  evidence = parseDataEvidence(evidence);
  const evidenceValid = evidence;
  const evidenceMissing = needsEvidence && !evidenceValid;
  const evidenceConflict = needsEvidence && evidenceValid && (evidence.dataConflict > 0 || (evidence.seedMissing > 0 && applied.has(plan.migrations[4].name)) || (evidence.seedOutdated > 0 && applied.has(plan.migrations[11].name)));
  const drift = !selected || historyConflict || evidenceMissing || Boolean(evidenceConflict);
  const needsData = evidenceValid && evidenceFields.some(k => evidence[k] > 0);
  const recovery = !drift && needsEvidence && (!release || needsData) ? 'LEGACY_RESUME_CANDIDATE' as const : undefined;
  const nearest = baseline.profiles.filter(p => p.kind === 'RELEASE').sort((a, b) => differences(a.objects, actual).length - differences(b.objects, actual).length)[0];
  const compared = selected || knownSchema || nearest;
  const changedObjects = drift ? differences(compared.objects, actual) : [];
  return {
    drift, recovery, evidence, baseline: selected?.name ?? manual?.name,
    differences: changedObjects,
    ...(drift ? { review: {
      reason: evidenceConflict ? 'DATA_EVIDENCE_CONFLICT' as const : evidenceMissing ? 'DATA_EVIDENCE_REQUIRED' as const : historyConflict || knownSchema ? 'KNOWN_SCHEMA_HISTORY_MISMATCH' as const : manual ? 'REVIEWED_DELTA_REQUIRED' as const : 'UNRECOGNIZED_SCHEMA' as const,
      baseline: manual?.name ?? compared.name,
      comparisonBaseline: compared.name,
      ...(evidenceConflict || evidenceMissing ? { dataEvidence: dataEvidenceReview(evidence, applied.has(plan.migrations[4].name), applied.has(plan.migrations[11].name)) } : {}),
      objects: changedObjects.map(key => ({ key, change: !(key in actual) ? 'MISSING' as const : !(key in compared.objects) ? 'ADDITIONAL' as const : 'CHANGED' as const,
        // Attribute names are repository-owned too. Unknown remote fields must
        // never become a route for leaking an identifier, SQL or a credential.
        ...(compared.attributes?.[key] ? { attributes: Object.entries(compared.attributes[key]).map(([name, expectedDigest]) => ({ name, state: actualAttributes[key]?.[name] === expectedDigest ? 'SAME' as const : 'DIFFERENT' as const, expectedDigest, actualDigest: actualAttributes[key]?.[name] })) } : {}),
      })),
    } } : {}),
    migrations: plan.migrations.map((m,i) => {
      const dataPending = evidenceValid && (([1,4].includes(i) && evidence.seedMissing > 0) || (i === 11 && evidence.seedOutdated > 0) || (i === 7 && evidence.storageMissing > 0) || ([21,23].includes(i) && evidence.progressMissing > 0));
      return { name: m.name, status: drift ? 'DRIFT_REQUIRES_REVIEW' : dataPending ? 'PENDING' : applied.has(m.name) ? 'APPLIED_BY_HISTORY' : release || (recoverySupported && i < (selected?.prefix ?? 0)) ? 'SATISFIED_BY_STATE' : 'PENDING' };
    }),
  };
}
export async function inspectMigrationState(backend: InstallerBackend, target: InstallerTarget, plan: InstallerPlan, history?: string[]): Promise<MigrationAssessment> {
  const applied = history ?? await backend.listAppliedMigrations(target);
  if (plan.databaseBaseline && !backend.inspectDatabaseCatalog) throw manualReview();
  let catalog = plan.databaseBaseline ? await backend.inspectDatabaseCatalog!(target) : undefined;
  let structural = assessDatabaseState(plan, applied, catalog);
  let permissions: unknown;
  if (catalog && structural.drift && structural.differences.length && backend.inspectDatabasePermissions) {
    permissions = await backend.inspectDatabasePermissions(target).catch(() => undefined);
    // Exact structure + trusted direct/PUBLIC rights + effective roles only.
    // The data evidence gate still runs below on the normalized representation.
    const equivalent = normalizeEquivalentCatalog(plan,catalog,permissions);
    if (equivalent) { catalog = equivalent; structural = assessDatabaseState(plan,applied,catalog); }
  }
  const transition = plan.legacyRecovery?.transitions.find(t => t.from === structural.baseline);
  const finish = async (assessment: MigrationAssessment) => {
    if (assessment.review && plan.databaseBaseline) {
      // Optional diagnostics must neither weaken the original gate nor turn a
      // permission-query failure into a failure for otherwise recognized DBs.
      permissions ??= await backend.inspectDatabasePermissions?.(target).catch(() => undefined);
      assessment = { ...assessment, review: { ...assessment.review, permissionContext: permissionContext(permissions), objects: assessment.review.objects.map(object => ({ ...object,
        category: classifyPermissionDifference({ profile: assessment.review!.comparisonBaseline, key: object.key, migrationHashes: plan.databaseBaseline!.migrationHashes, actual: permissions,
          structural: object.change !== 'CHANGED' || Boolean(object.attributes?.some(a => a.state === 'DIFFERENT' && a.name !== 'acl')),
        }),
      })) } };
    }
    if (plan.databaseBaseline && assessment.review) {
      assessment = { ...assessment, differences: assessment.differences.map(key => diagnosticObjectKey(key, plan.databaseBaseline!)), review: { ...assessment.review, objects: assessment.review.objects.map(({key, ...difference}) => ({ key: diagnosticObjectKey(key, plan.databaseBaseline!), ...difference })) } };
    }
    if (assessment.drift && assessment.review) {
      const { reason, baseline, comparisonBaseline, objects, permissionContext, dataEvidence } = assessment.review;
      console.error(JSON.stringify({ event: 'schema_review', projectRef: /^[a-z0-9-]{8,64}$/.test(target.projectRef) ? target.projectRef : '[invalid]', reason, baseline, comparisonBaseline, differenceCount: objects.length, objects, permissionContext, dataEvidence }));
    }
    return assessment;
  };
  if (!transition || (structural.drift && structural.review?.reason !== 'DATA_EVIDENCE_REQUIRED')) return finish(structural);
  if (!backend.inspectDataEvidence) return finish(structural);
  const evidence = await backend.inspectDataEvidence(target, transition.evidenceQuery);
  return finish(assessDatabaseState(plan, applied, catalog, evidence));
}
export function manualReview(): InstallerError {
  return new InstallerError('INSTALLER_MANUAL_REVIEW_REQUIRED', 'migrations', '자동 업데이트로 변경하기 전에 확인이 필요합니다.');
}
