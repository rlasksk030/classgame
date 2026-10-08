/** Only aggregate counts and shipped problem codes cross the boundary. Never
 * return content, students, policy expressions, UUIDs or unknown properties. */
export const evidenceFields = ['seedMissing', 'seedOutdated', 'storageMissing', 'progressMissing', 'dataConflict'] as const;
export const evidenceDetails = ['duplicateSeedCount', 'storageBucketConflictCount', 'storagePolicyConflictCount', 'seedIdentityConflictCount', 'customizedSeedCount', 'classProblemCount', 'duplicateSeedReferencedCount'] as const;
export const outdatedSeedCodes = ['L1-03','L2-01','L2-03','L5-01','L12-04'] as const;
export const seedReferenceFields = ['attemptCount','snapshotCount','progressCount','lessonProgressCount','practiceAssignmentCount'] as const;
export type OutdatedSeedDetail = { code: typeof outdatedSeedCodes[number] } & Record<typeof seedReferenceFields[number], number>;
type DataEvidenceCounts = Record<typeof evidenceFields[number], number> & Partial<Record<typeof evidenceDetails[number], number>>;
export type DataEvidence = DataEvidenceCounts & { outdatedSeedDetails?: OutdatedSeedDetail[] };
export interface DataEvidenceReview {
  classification: 'SAFE_NO_CHANGE' | 'SAFE_ADDITIVE' | 'REVIEW_REQUIRED' | 'UNSAFE';
  counts: Partial<DataEvidenceCounts>;
  outdatedSeeds?: OutdatedSeedDetail[];
  triggers: Array<'DUPLICATE_SEED' | 'SEED_IDENTITY_CONFLICT' | 'STORAGE_BUCKET_CONFLICT' | 'STORAGE_POLICY_CONFLICT' | 'SEED_MISSING_WITH_HISTORY' | 'SEED_OUTDATED_WITH_HISTORY' | 'UNCLASSIFIED_DATA_CONFLICT' | 'EVIDENCE_UNAVAILABLE'>;
  readOnly: true;
}
export function parseDataEvidence(value: unknown): DataEvidence | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const valid = (key: string) => Number.isSafeInteger(source[key]) && Number(source[key]) >= 0;
  if (evidenceFields.some(k => !valid(k)) || evidenceDetails.some(k => k in source && !valid(k))) return undefined;
  const split = ['duplicateSeedCount','storageBucketConflictCount','storagePolicyConflictCount','seedIdentityConflictCount'];
  if (split.every(k => k in source) && split.reduce((n,k) => n + Number(source[k]), 0) !== source.dataConflict) return undefined;
  const result = Object.fromEntries([...evidenceFields,...evidenceDetails].filter(k => k in source).map(k => [k, source[k]])) as DataEvidence;
  if ('outdatedSeedDetails' in source) {
    const rows = source.outdatedSeedDetails;
    if (!Array.isArray(rows) || rows.length > outdatedSeedCodes.length || rows.length !== result.seedOutdated) return undefined;
    const seen = new Set<string>();
    result.outdatedSeedDetails = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || !outdatedSeedCodes.includes(row.code) || seen.has(row.code) || seedReferenceFields.some(k => !Number.isSafeInteger(row[k]) || row[k] < 0)) return undefined;
      seen.add(row.code);
      result.outdatedSeedDetails.push(Object.fromEntries(['code',...seedReferenceFields].map(k => [k,row[k]])) as OutdatedSeedDetail);
    }
  }
  return result;
}
export function dataEvidenceReview(value: unknown, seedHistory: boolean, correctionHistory: boolean): DataEvidenceReview {
  const parsed = parseDataEvidence(value);
  if (!parsed) return { classification: 'REVIEW_REQUIRED', counts: {}, triggers: ['EVIDENCE_UNAVAILABLE'], readOnly: true };
  const { outdatedSeedDetails, ...counts } = parsed;
  const triggers: DataEvidenceReview['triggers'] = [];
  if (counts.duplicateSeedCount) triggers.push('DUPLICATE_SEED');
  if (counts.seedIdentityConflictCount) triggers.push('SEED_IDENTITY_CONFLICT');
  if (counts.storageBucketConflictCount) triggers.push('STORAGE_BUCKET_CONFLICT');
  if (counts.storagePolicyConflictCount) triggers.push('STORAGE_POLICY_CONFLICT');
  if (counts.dataConflict && !triggers.length) triggers.push('UNCLASSIFIED_DATA_CONFLICT');
  if (seedHistory && counts.seedMissing) triggers.push('SEED_MISSING_WITH_HISTORY');
  if (correctionHistory && counts.seedOutdated) triggers.push('SEED_OUTDATED_WITH_HISTORY');
  return { counts, ...(outdatedSeedDetails ? { outdatedSeeds: outdatedSeedDetails } : {}), triggers, readOnly: true, classification: triggers.length ? 'REVIEW_REQUIRED' : evidenceFields.some(k => counts[k] > 0) ? 'SAFE_ADDITIVE' : 'SAFE_NO_CHANGE' };
}
