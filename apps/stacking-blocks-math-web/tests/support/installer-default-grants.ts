import assert from 'node:assert/strict';
import { assessDatabaseState, catalogFingerprints, catalogAttributeFingerprints, type Catalog } from '../../scripts/installer/database-state.ts';
import type { InstallerPlan } from '../../scripts/installer/orchestrator.ts';

const oldTables=['sb_block_snapshots','sb_challenge_solves','sb_classes','sb_lesson_settings','sb_problem_attempts','sb_problems','sb_projects','sb_self_evaluations','sb_shared_challenges','sb_student_pin_vault','sb_student_progress','sb_student_rewards','sb_student_sessions','sb_students','sb_teacher_settings','sb_worksheet_imports'];
const rpcKeys=['rpcs::sb_owns_class:target uuid','rpcs::sb_owns_student:target uuid','rpcs::sb_public_class_info:p_class_code text','rpcs::sb_reset_progress:p_student uuid, p_lesson integer','rpcs::sb_touch_updated_at:','rpcs::sb_track_challenge_author:'];

/** The nearest diagnostic profile can differ. Always compare the reported
 * 22-object incident against its actual history-prefix release as well. */
export function assertSupabaseDefaultDrift(plan: InstallerPlan, catalog: Catalog, mode: 'historical-defaults'|'crud-opt-out') {
  const latest=plan.databaseBaseline!.profiles.find(p=>p.name===`history-prefix-${plan.migrations.length}`)!;
  const fingerprints=catalogFingerprints(catalog),attributes=catalogAttributeFingerprints(catalog);
  const differing=[...new Set([...Object.keys(latest.objects),...Object.keys(fingerprints)])].filter(k=>latest.objects[k]!==fingerprints[k]).sort();
  assert.deepEqual(differing,[...oldTables.map(t=>`tables::${t}:`),...rpcKeys].sort(),`${mode}: exact 16-table/6-RPC difference from the migration release`);
  for(const key of differing) assert.deepEqual(Object.entries(latest.attributes![key]).filter(([a,d])=>attributes[key][a]!==d).map(([a])=>a),['acl'],`${key}: no hidden structural difference from migration release`);
  const state=assessDatabaseState(plan,[],catalog);
  assert.equal(state.drift,true);
  assert.ok(state.migrations.every(m=>m.status==='DRIFT_REQUIRES_REVIEW'));
  // The added exact manual/live-v4 model is closer, but never authorizes
  // broader defaults. Keep the independent 22-object release check above.
  const expected=[...rpcKeys,...(mode==='historical-defaults' ? oldTables.filter(t=>t!=='sb_student_sessions').map(t=>`tables::${t}:`) : [])].map(key=>({key,attributes:['acl']}));
  assert.equal(state.review!.comparisonBaseline,'manual-live-v4-contract');
  assert.deepEqual(state.review!.objects.map(o=>({key:o.key,attributes:o.attributes!.filter(a=>a.state==='DIFFERENT').map(a=>a.name)})).sort((a,b)=>a.key.localeCompare(b.key)),expected.sort((a,b)=>a.key.localeCompare(b.key)));
  return state;
}
