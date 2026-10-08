/** Only aggregate counts cross the installer boundary. Never return a problem,
 * student, policy expression, identifier, or unrecognized remote property. */
export const evidenceFields = ['seedMissing', 'seedOutdated', 'storageMissing', 'progressMissing', 'dataConflict'] as const;
export const evidenceDetails = ['duplicateSeedCount', 'storageBucketConflictCount', 'storagePolicyConflictCount', 'seedIdentityConflictCount', 'customizedSeedCount', 'classProblemCount', 'duplicateSeedReferencedCount'] as const;
export type DataEvidence = Record<typeof evidenceFields[number], number> & Partial<Record<typeof evidenceDetails[number], number>>;
export interface DataEvidenceReview {
  classification: 'SAFE_NO_CHANGE' | 'SAFE_ADDITIVE' | 'REVIEW_REQUIRED' | 'UNSAFE';
  counts: Partial<DataEvidence>;
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
  return Object.fromEntries([...evidenceFields,...evidenceDetails].filter(k => k in source).map(k => [k, source[k]])) as DataEvidence;
}
export function dataEvidenceReview(value: unknown, seedHistory: boolean, correctionHistory: boolean): DataEvidenceReview {
  const counts = parseDataEvidence(value);
  if (!counts) return { classification: 'REVIEW_REQUIRED', counts: {}, triggers: ['EVIDENCE_UNAVAILABLE'], readOnly: true };
  const triggers: DataEvidenceReview['triggers'] = [];
  if (counts.duplicateSeedCount) triggers.push('DUPLICATE_SEED');
  if (counts.seedIdentityConflictCount) triggers.push('SEED_IDENTITY_CONFLICT');
  if (counts.storageBucketConflictCount) triggers.push('STORAGE_BUCKET_CONFLICT');
  if (counts.storagePolicyConflictCount) triggers.push('STORAGE_POLICY_CONFLICT');
  if (counts.dataConflict && !triggers.length) triggers.push('UNCLASSIFIED_DATA_CONFLICT');
  if (seedHistory && counts.seedMissing) triggers.push('SEED_MISSING_WITH_HISTORY');
  if (correctionHistory && counts.seedOutdated) triggers.push('SEED_OUTDATED_WITH_HISTORY');
  return { counts, triggers, readOnly: true, classification: triggers.length ? 'REVIEW_REQUIRED' : evidenceFields.some(k => counts[k] > 0) ? 'SAFE_ADDITIVE' : 'SAFE_NO_CHANGE' };
}
