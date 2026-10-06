import { createHash } from 'node:crypto';
import { InstallerError, type InstallerBackend, type InstallerTarget } from './contract.ts';
import type { InstallerPlan } from './orchestrator.ts';

export type MigrationDisposition = 'APPLIED_BY_HISTORY' | 'SATISFIED_BY_STATE' | 'PENDING' | 'DRIFT_REQUIRES_REVIEW';
export type Catalog = Record<string, Array<Record<string, unknown>>>;
export interface DatabaseBaseline {
  migrationHashes: string[];
  profiles: Array<{ name: string; kind: 'RELEASE' | 'RESUME' | 'MANUAL_DELTA_REQUIRED'; prefix: number; objects: Record<string, string> }>;
}
export interface DataEvidence { seedMissing: number; seedOutdated: number; storageMissing: number; progressMissing: number; dataConflict: number }
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
    objects: Array<{ key: string; change: 'MISSING' | 'ADDITIONAL' | 'CHANGED' }>;
  };
}
const sections = ['tables', 'columns', 'constraints', 'indexes', 'policies', 'rpcs', 'rpc_definitions', 'triggers', 'column_acls', 'policy_modes'];
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function catalogFingerprints(catalog: Catalog): Record<string, string> {
  const objects: Record<string, string> = {};
  for (const section of sections) {
    if (!Array.isArray(catalog[section])) throw manualReview();
    for (const original of catalog[section]) {
      const row = { ...original };
      // PG18 exposes NOT NULL in pg_constraint; PG17 exposes it in columns.
      if (section === 'constraints' && row.type === 'n') continue;
      // Physical column order is not part of the named runtime contract.
      if (section === 'columns') delete row.position;
      const key = `${section}:${row.table ?? ''}:${row.name ?? row.column ?? ''}:${row.arguments ?? ''}`;
      if (objects[key]) throw manualReview();
      objects[key] = createHash('sha256').update(JSON.stringify(canonical(row))).digest('hex');
    }
  }
  return objects;
}
function differences(expected: Record<string, string>, actual: Record<string, string>): string[] {
  return [...new Set([...Object.keys(expected), ...Object.keys(actual)])].filter(k => expected[k] !== actual[k]).sort();
}
export function assessDatabaseState(plan: InstallerPlan, history: string[], catalog?: Catalog, evidence?: DataEvidence): MigrationAssessment {
  const applied = new Set(history);
  if (!plan.databaseBaseline) return { drift: false, differences: [], migrations: plan.migrations.map(m => ({ name: m.name, status: applied.has(m.name) ? 'APPLIED_BY_HISTORY' : 'PENDING' })) };
  const baseline = plan.databaseBaseline;
  const hashes = plan.migrations.map(m => createHash('sha256').update(m.query).digest('hex'));
  if (JSON.stringify(hashes) !== JSON.stringify(baseline.migrationHashes) || !catalog) throw manualReview();
  const actual = catalogFingerprints(catalog);
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
  const evidenceValid = evidence && ['seedMissing','seedOutdated','storageMissing','progressMissing','dataConflict'].every(k => Number.isSafeInteger(evidence[k as keyof DataEvidence]) && evidence[k as keyof DataEvidence] >= 0);
  const evidenceMissing = needsEvidence && !evidenceValid;
  const evidenceConflict = needsEvidence && evidenceValid && (evidence.dataConflict > 0 || (evidence.seedMissing > 0 && applied.has(plan.migrations[4].name)) || (evidence.seedOutdated > 0 && applied.has(plan.migrations[11].name)));
  const drift = !selected || historyConflict || evidenceMissing || Boolean(evidenceConflict);
  const needsData = evidenceValid && Object.values(evidence).some(n => n > 0);
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
      objects: changedObjects.map(key => ({ key, change: !(key in actual) ? 'MISSING' as const : !(key in compared.objects) ? 'ADDITIONAL' as const : 'CHANGED' as const })),
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
  const catalog = plan.databaseBaseline ? await backend.inspectDatabaseCatalog!(target) : undefined;
  const structural = assessDatabaseState(plan, applied, catalog);
  const transition = plan.legacyRecovery?.transitions.find(t => t.from === structural.baseline);
  if (!transition || (structural.drift && structural.review?.reason !== 'DATA_EVIDENCE_REQUIRED')) return structural;
  if (!backend.inspectDataEvidence) return structural;
  const evidence = await backend.inspectDataEvidence(target, transition.evidenceQuery);
  return assessDatabaseState(plan, applied, catalog, evidence);
}
export function manualReview(): InstallerError {
  return new InstallerError('INSTALLER_MANUAL_REVIEW_REQUIRED', 'migrations', '자동 업데이트로 변경하기 전에 확인이 필요합니다.');
}
