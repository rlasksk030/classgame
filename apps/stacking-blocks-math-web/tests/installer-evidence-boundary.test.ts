import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDataEvidence, dataEvidenceReview } from '../scripts/installer/data-evidence.ts';
const clean = {seedMissing:0,seedOutdated:0,storageMissing:0,progressMissing:0,dataConflict:0};
test('data diagnostics strip unknown private fields; positive informational counts do not require recovery', () => {
  const input={...clean,customizedSeedCount:4,classProblemCount:27,duplicateSeedReferencedCount:0,studentRows:['private'],policy:'private'};
  assert.deepEqual(parseDataEvidence(input),{...clean,customizedSeedCount:4,classProblemCount:27,duplicateSeedReferencedCount:0});
  assert.equal(dataEvidenceReview(input,true,true).classification,'SAFE_NO_CHANGE');
  for(const value of [undefined,{}, {...clean,seedMissing:'0'}, {...clean,seedMissing:-1},{...clean,classProblemCount:Infinity},{...clean,progressMissing:0.5}]) {
    assert.equal(parseDataEvidence(value),undefined);
    assert.deepEqual(dataEvidenceReview(value,true,true).counts,{});
  }
});
test('conflicts are distinct bounded counts; evidence with an inconsistent breakdown stays unknown', () => {
  const input={...clean,dataConflict:7,duplicateSeedCount:1,storageBucketConflictCount:2,storagePolicyConflictCount:3,seedIdentityConflictCount:1};
  assert.deepEqual(dataEvidenceReview(input,true,true).triggers,['DUPLICATE_SEED','SEED_IDENTITY_CONFLICT','STORAGE_BUCKET_CONFLICT','STORAGE_POLICY_CONFLICT']);
  assert.equal(dataEvidenceReview(input,true,true).classification,'REVIEW_REQUIRED');
  assert.equal(parseDataEvidence({...input,dataConflict:8}),undefined);
  assert.deepEqual(dataEvidenceReview({...clean,dataConflict:2},true,true).triggers,['UNCLASSIFIED_DATA_CONFLICT']);
});
test('historical seed contradiction is not silently approved; ordinary missing additions are separately labeled', () => {
  assert.deepEqual(dataEvidenceReview({...clean,seedMissing:1,seedOutdated:2},true,true).triggers,['SEED_MISSING_WITH_HISTORY','SEED_OUTDATED_WITH_HISTORY']);
  assert.equal(dataEvidenceReview({...clean,storageMissing:1,progressMissing:2},true,true).classification,'SAFE_ADDITIVE');
  assert.equal(dataEvidenceReview({...clean,seedMissing:1},false,false).readOnly,true);
});
