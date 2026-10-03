/* global process, console */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMathInstallerPlan } from '../../scripts/installer/math-plan.ts';
const [catalogPath,output]=process.argv.slice(2);
if(!catalogPath||!output)throw new Error('Usage: node --experimental-strip-types installer-gate.mjs PRIVATE_CATALOG.json PRIVATE_RESULT.json');
const catalog=JSON.parse(readFileSync(catalogPath)),app=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const plan=await readMathInstallerPlan(app);
const history=new Set(catalog.migration_history.map(m=>`${m.version}_${m.name}.sql`));
const pending=plan.migrations.filter(m=>!history.has(m.name));
assert.ok(pending.some(m=>m.name==='20261002104459_live_v4_compatibility.sql'));
assert.deepEqual(plan.functions.map(f=>f.slug).sort(),['student-api','student-auth']);
assert.equal(plan.migrations.some(m=>m.name==='20261003051402_actual_use_required_progress_delta.sql'),false,'QA delta is deliberately outside automatic installer migration discovery');
writeFileSync(output,JSON.stringify({test:'installer pending plan remains unsafe after manual standalone delta',status:'PASS',production_gate:'BLOCKED; do not invoke generic update',pending:pending.map(m=>m.name),function_deploy_scope:plan.functions.map(f=>f.slug),history_replay_performed:false},null,2));
console.log('PASS installer safety gate: generic update remains BLOCKED;',pending.length,'pending migrations; two-function scope');
