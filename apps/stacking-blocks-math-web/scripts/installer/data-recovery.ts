import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { catalogFingerprints, type Catalog } from './database-state.ts';
import { parseDataEvidence, seedReferenceFields, type OutdatedSeedDetail } from './data-evidence.ts';
import { normalizeEquivalentCatalog } from './permission-recovery.ts';
import { identifier, literal } from './legacy-sql.ts';
import type { InstallerPlan } from './orchestrator.ts';

export type DataRecoveryReason = 'NO_DATA_REPAIR_REQUIRED' | 'DATA_CONFLICT_REQUIRES_REVIEW' | 'UNSUPPORTED_DATA_REPAIR' | 'UNSAFE_STRUCTURE' | 'HISTORY_MISMATCH';
export interface DataRecoveryChange {
  code: 'L1-03'; fields: ['answer','updated_at']; historicalFeedbackChanges: true;
  referenceCounts: Omit<OutdatedSeedDetail,'code'>;
}
export type DataRecovery = { recoverable:false; reason:DataRecoveryReason } | {
  recoverable:true; profile:string; changes:DataRecoveryChange[]; query:string; fingerprint:string;
};
const correctionFields = ['problem_type','prompt','choices','answer','given_blocks','given'];
const targetId = '95dd8f12-9215-430b-893c-d830c0368798';
const sort = (value:unknown):unknown => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(sort) : Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sort(v)])) : value;
const equal = (a:unknown,b:unknown):boolean=>JSON.stringify(sort(a))===JSON.stringify(sort(b));
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
const deny=(reason:DataRecoveryReason):DataRecovery=>({recoverable:false,reason});

/** This is an explicit-consent data correction, never a claim that the old
 * answer representation was equivalent. HTTP must separately bind project,
 * session, credential, expiry and the historical-feedback acknowledgement. */
export function buildDataRecovery(plan:InstallerPlan,history:string[],catalog:Catalog,permissions:unknown,inputEvidence:unknown):DataRecovery {
  try {
    const evidence=parseDataEvidence(inputEvidence);
    if (!evidence) return deny('UNSUPPORTED_DATA_REPAIR');
    if (evidence.seedOutdated===0) return deny('NO_DATA_REPAIR_REQUIRED');
    if (evidence.seedOutdated!==1 || ['seedMissing','storageMissing','progressMissing','dataConflict'].some(k=>evidence[k as keyof typeof evidence]!==0)) return deny('DATA_CONFLICT_REQUIRES_REVIEW');
    const detail=evidence.outdatedSeedDetails?.[0];
    if (evidence.outdatedSeedDetails?.length!==1 || detail?.code!=='L1-03' || seedReferenceFields.some(k=>!Number.isSafeInteger(detail[k]) || detail[k]<0)) return deny('UNSUPPORTED_DATA_REPAIR');
    const correction=plan.legacyRecovery?.knownSeedCorrection;
    if (!correction || correction.code!=='L1-03' || correction.id!==targetId || correction.before.problem_type!=='FREE_BUILD'
      || !equal(Object.keys(correction.before).sort(),[...correctionFields].sort()) || !equal(Object.keys(correction.after).sort(),[...correctionFields].sort())
      || !equal(correction.before.answer,{kind:'count',value:6}) || !equal(correction.after.answer,{kind:'blocks',blocks:[]})
      || correctionFields.filter(k=>!equal(correction.before[k],correction.after[k])).join(',')!=='answer') return deny('UNSUPPORTED_DATA_REPAIR');
    const hashes=plan.migrations.map(m=>createHash('sha256').update(m.query).digest('hex'));
    if (!equal(hashes,plan.legacyRecovery!.migrationHashes)) return deny('UNSUPPORTED_DATA_REPAIR');
    const normalized=normalizeEquivalentCatalog(plan,catalog,permissions);
    if (!normalized) return deny('UNSAFE_STRUCTURE');
    const fingerprints=catalogFingerprints(normalized);
    // A reviewed manual installation has no migration-prefix identity. Accept
    // only complete, explicitly reviewed structures, never an older/resume profile.
    const profile=plan.databaseBaseline?.profiles.find(p=>p.kind==='RELEASE'
      && ((p.name===`history-prefix-${plan.migrations.length}` && p.prefix===plan.migrations.length)
        || (['manual-required-progress-contract','manual-live-v4-contract'].includes(p.name) && p.prefix===0))
      && equal(p.objects,fingerprints));
    const transition=profile ? plan.legacyRecovery?.transitions.find(t=>t.from===profile.name && t.to===profile.name) : undefined;
    if (!profile || !transition) return deny('UNSAFE_STRUCTURE');
    const names=new Set(plan.migrations.map(m=>m.name));
    if (new Set(history).size!==history.length || history.some(name=>!names.has(name))) return deny('HISTORY_MISMATCH');
    const changes:DataRecoveryChange[]=[{code:'L1-03',fields:['answer','updated_at'],historicalFeedbackChanges:true,referenceCounts:Object.fromEntries(seedReferenceFields.map(k=>[k,detail[k]])) as Omit<OutdatedSeedDetail,'code'>}];
    const catalogQuery=readFileSync(new URL('./catalog.sql',import.meta.url),'utf8').trim().replace(/;$/,'');
    const permissionQuery=readFileSync(new URL('./permission-audit.sql',import.meta.url),'utf8').trim().replace(/;$/,'');
    const evidenceQuery=transition.evidenceQuery.trim().replace(/;$/,'');
    const tables=catalog.tables.map(t=>String(t.name)).sort();
    const rows=tables.map(name=>`select ${literal(name)} table_name,to_jsonb(t) row_data from public.${identifier(name)} t`).join('\nunion all\n');
    const content=`jsonb_build_object(${correctionFields.flatMap(k=>[literal(k),`p.${identifier(k)}`]).join(',')})`;
    const afterEvidence={...evidence,seedOutdated:0,outdatedSeedDetails:[]};
    const query=`BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
SET LOCAL standard_conforming_strings=on;
SET LOCAL search_path=pg_catalog,public;
DO $data_guard$ BEGIN IF current_user <> 'postgres' THEN RAISE EXCEPTION 'INSTALLER_DATA_EXECUTOR_INVALID'; END IF; END $data_guard$;
SELECT pg_advisory_xact_lock(hashtext('stacking-blocks-math:data-recovery'));
LOCK TABLE ${tables.map(name=>`public.${identifier(name)}`).join(',')} IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMPORARY TABLE sb_data_recovery_expected ON COMMIT DROP AS SELECT ${literal(JSON.stringify(catalog))}::jsonb catalog,${literal(JSON.stringify(permissions))}::jsonb permissions,${literal(JSON.stringify(evidence))}::jsonb evidence,${literal(JSON.stringify(afterEvidence))}::jsonb after_evidence,${literal(JSON.stringify(correction.before))}::jsonb before_content,${literal(JSON.stringify(correction.after))}::jsonb after_content;
DO $data_guard$ BEGIN
IF (SELECT snapshot FROM (${catalogQuery}) c) IS DISTINCT FROM (SELECT catalog FROM pg_temp.sb_data_recovery_expected) THEN RAISE EXCEPTION 'INSTALLER_DATA_PLAN_STALE'; END IF;
IF (SELECT snapshot FROM (${permissionQuery}) p) IS DISTINCT FROM (SELECT permissions FROM pg_temp.sb_data_recovery_expected) THEN RAISE EXCEPTION 'INSTALLER_DATA_PLAN_STALE'; END IF;
IF (SELECT evidence FROM (${evidenceQuery}) e) IS DISTINCT FROM (SELECT evidence FROM pg_temp.sb_data_recovery_expected) THEN RAISE EXCEPTION 'INSTALLER_DATA_PLAN_STALE'; END IF;
IF (SELECT count(*) FROM public.sb_problems p WHERE p.id=${literal(targetId)}::uuid AND p.class_id IS NULL AND p.code='L1-03' AND ${content}=(SELECT before_content FROM pg_temp.sb_data_recovery_expected))<>1 THEN RAISE EXCEPTION 'INSTALLER_DATA_PLAN_STALE'; END IF;
END $data_guard$;
CREATE TEMPORARY TABLE sb_data_recovery_rows ON COMMIT DROP AS ${rows};
DO $data_apply$ DECLARE changed integer; BEGIN
UPDATE public.sb_problems p SET answer=(SELECT after_content->'answer' FROM pg_temp.sb_data_recovery_expected) WHERE p.id=${literal(targetId)}::uuid AND p.class_id IS NULL AND p.code='L1-03' AND ${content}=(SELECT before_content FROM pg_temp.sb_data_recovery_expected);
GET DIAGNOSTICS changed=ROW_COUNT;
IF changed<>1 THEN RAISE EXCEPTION 'INSTALLER_DATA_PLAN_STALE'; END IF;
END $data_apply$;
-- Account only for the reviewed answer change and the existing update trigger.
UPDATE pg_temp.sb_data_recovery_rows SET row_data=jsonb_set(jsonb_set(row_data,'{answer}',(SELECT after_content->'answer' FROM pg_temp.sb_data_recovery_expected)),'{updated_at}',to_jsonb(transaction_timestamp())) WHERE table_name='sb_problems' AND row_data->>'id'=${literal(targetId)};
DO $data_guard$ BEGIN
IF (SELECT snapshot FROM (${catalogQuery}) c) IS DISTINCT FROM (SELECT catalog FROM pg_temp.sb_data_recovery_expected) THEN RAISE EXCEPTION 'INSTALLER_DATA_STRUCTURE_CHANGED'; END IF;
IF (SELECT snapshot FROM (${permissionQuery}) p) IS DISTINCT FROM (SELECT permissions FROM pg_temp.sb_data_recovery_expected) THEN RAISE EXCEPTION 'INSTALLER_DATA_PERMISSIONS_CHANGED'; END IF;
IF (SELECT evidence FROM (${evidenceQuery}) e) IS DISTINCT FROM (SELECT after_evidence FROM pg_temp.sb_data_recovery_expected) THEN RAISE EXCEPTION 'INSTALLER_DATA_POSTCONDITION_FAILED'; END IF;
IF EXISTS((SELECT * FROM pg_temp.sb_data_recovery_rows EXCEPT ALL (${rows})) UNION ALL ((${rows}) EXCEPT ALL SELECT * FROM pg_temp.sb_data_recovery_rows)) THEN RAISE EXCEPTION 'INSTALLER_DATA_PRESERVATION_FAILED'; END IF;
END $data_guard$;
COMMIT;`;
    return {recoverable:true,profile:profile.name,changes,query,fingerprint:digest({history:[...history].sort(),catalog,permissions,evidence,correction,query})};
  } catch { return deny('UNSUPPORTED_DATA_REPAIR'); }
}
