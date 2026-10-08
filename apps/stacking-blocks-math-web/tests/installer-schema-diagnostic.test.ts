import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inspectMigrationState, catalogAttributeFingerprints, catalogFingerprints, type Catalog } from '../scripts/installer/database-state.ts';
import { createFakeInstallerBackend } from '../scripts/installer/fake-backend.ts';
import type { InstallerPlan } from '../scripts/installer/orchestrator.ts';

test('schema review emits exact difference metadata, never SQL, rows, keys or credentials', async () => {
  const empty: Catalog = Object.fromEntries(['tables','columns','constraints','indexes','policies','rpcs','rpc_definitions','triggers','column_acls','policy_modes'].map(k => [k, []]));
  const expected = structuredClone(empty);
  expected.columns = Array.from({length: 22}, (_, i) => ({ table: 'sb_students', name: 'column_' + i, type: 'text' }));
  const actual = structuredClone(expected);
  actual.columns.forEach(c => { c.type = 'integer'; c.definition = 'select synthetic_sql_body'; c.token = 'synthetic-access-token'; c.pin = 'synthetic-pin'; c.rows = ['synthetic-student']; c.apiKey = 'synthetic-api-key'; });
  const plan: InstallerPlan = { productionRef: 'blocked-project', appVersion: 'test', schemaVersion: 'test', functions: [], migrations: [{name: 'test', query: 'select 1'}], databaseBaseline: {migrationHashes:[createHash('sha256').update('select 1').digest('hex')], profiles:[{name:'history-prefix-24',kind:'RELEASE',prefix:1,objects:catalogFingerprints(expected),attributes:catalogAttributeFingerprints(expected)}]} };
  const backend = createFakeInstallerBackend(); backend.inspectDatabaseCatalog = async () => actual;
  const lines: string[] = []; const original = console.error;
  console.error = value => lines.push(String(value));
  try {
    const result = await inspectMigrationState(backend, { environment:'TEST',projectRef:'existing-project',projectUrl:'https://existing-project.supabase.co',release:'test'}, plan);
    assert.equal(result.review?.reason, 'UNRECOGNIZED_SCHEMA');
    assert.equal(result.review?.objects.length, 22);
    assert.ok(result.review?.objects.every(o => o.change === 'CHANGED' && o.category === 'D_STRUCTURAL_CHANGE'));
    assert.deepEqual(result.review?.permissionContext, { available: false });
    assert.equal(lines.length, 1);
    const log = JSON.parse(lines[0]);
    assert.deepEqual(log.objects, result.review?.objects);
    assert.equal(log.differenceCount, 22); assert.equal(log.projectRef, 'existing-project');
    assert.deepEqual(Object.keys(log).sort(), ['event','projectRef','reason','baseline','comparisonBaseline','differenceCount','objects','permissionContext'].sort());
    assert.deepEqual(log.permissionContext, { available: false });
    for (const object of log.objects) {
      assert.deepEqual(Object.keys(object).sort(), ['key','change','attributes','category'].sort());
      assert.ok(object.attributes.every((a: {name: string}) => ['table','name','type'].includes(a.name)));
    }
    for (const sensitive of ['synthetic_sql_body','synthetic-access-token','synthetic-pin','synthetic-student','synthetic-api-key']) assert.equal(JSON.stringify(result).includes(sensitive) || lines.join('').includes(sensitive), false);
    actual.columns.push({table:'sb_students',name:'synthetic-access-token',type:'text'});
    // Remote permission metadata is equally untrusted. Only bounded enum/
    // boolean/count diagnostics may leave the backend, never raw role data.
    backend.inspectDatabasePermissions = async () => ({
      roles: { 'synthetic-api-key': { password: 'synthetic-access-token' } },
      schema: { owner: 'synthetic-pin', definition: 'select synthetic_sql_body' },
      defaultPrivileges: [{ teacher: 'synthetic-student' }],
      objects: { 'synthetic-access-token': { rawAcl: 'synthetic-api-key' } },
    });
    const hostile = await inspectMigrationState(backend, { environment:'TEST',projectRef:'existing-project',projectUrl:'https://existing-project.supabase.co',release:'test'}, plan);
    assert.deepEqual(hostile.review?.permissionContext, { available: true, schemaOwnerKnown: false, defaultPrivilegeEntries: 1, applicationRoleContextChanged: true, executorRoleModel: 'UNVERIFIED' });
    for (const sensitive of ['synthetic_sql_body','synthetic-access-token','synthetic-pin','synthetic-student','synthetic-api-key']) assert.equal(JSON.stringify(hostile).includes(sensitive) || lines.join('').includes(sensitive), false);
    assert.equal(hostile.review?.objects.filter(o => o.change === 'ADDITIONAL').length, 1);
    assert.equal(backend.calls.some(c=>/^(apply|setSecrets|deploy)/.test(c)),false);
  } finally { console.error = original; }
});
