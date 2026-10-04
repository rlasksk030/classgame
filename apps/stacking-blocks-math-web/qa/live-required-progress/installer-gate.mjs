/* global process, console, URL */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMathInstallerPlan } from '../../scripts/installer/math-plan.ts';
import { assessDatabaseState } from '../../scripts/installer/database-state.ts';
import { runInstaller } from '../../scripts/installer/orchestrator.ts';
import { createFakeInstallerBackend } from '../../scripts/installer/fake-backend.ts';
import { createFixture, snapshot } from './installer-fixture.mjs';
const [catalogPath, output] = process.argv.slice(2);
if (!catalogPath || !output) throw new Error('Usage: node --experimental-strip-types installer-gate.mjs PRIVATE_CATALOG.json PRIVATE_RESULT.json');
const catalog = JSON.parse(readFileSync(catalogPath)), app = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const plan = await readMathInstallerPlan(app);
const history = catalog.migration_history.map(m => `${m.version}_${m.name}.sql`);
// Preserve the original FAIL evidence: history-only logic proposed four old migrations.
const historyOnlyPending = plan.migrations.filter(m => !history.includes(m.name));
assert.equal(historyOnlyPending.length, 4);
assert.ok(historyOnlyPending.some(m => m.name === '20261002104459_live_v4_compatibility.sql'));
assert.equal(assessDatabaseState(plan, history, catalog).drift, true);
assert.equal(plan.migrations.some(m => m.name === '20261003051402_actual_use_required_progress_delta.sql'), false);
const db = await createFixture(catalog);
try {
  await db.exec(readFileSync(new URL('./sql/20261003051402_actual_use_required_progress_delta.sql', import.meta.url), 'utf8'));
  const after = await snapshot(db);
  const state = assessDatabaseState(plan, history, after);
  assert.equal(state.drift, false);
  assert.equal(state.migrations.filter(m => m.status === 'PENDING').length, 0);
  assert.equal(state.migrations.filter(m => m.status === 'SATISFIED_BY_STATE').length, 4);
  const backend = createFakeInstallerBackend({ migrations: history, secrets: ['APP_SESSION_SECRET'], functions: plan.functions.map(f => ({ slug: f.slug, hash: f.hash, status: 'ACTIVE', verifyJwt: false })) });
  backend.inspectDatabaseCatalog = async () => after;
  assert.equal((await runInstaller({ target: { environment: 'TEST', projectRef: 'synthetic-manual-install', projectUrl: 'https://synthetic-manual-install.supabase.co', publishableKey: 'sb_publishable_synthetic', release: plan.appVersion }, plan, backend })).status, 'COMPLETE');
  assert.deepEqual(backend.calls.filter(c => /^(applyMigration|deployFunction|setSecrets)/.test(c)), []);
  writeFileSync(output, JSON.stringify({ test: 'manual standalone delta must not replay old migrations', status: 'PASS', scope: 'LOCAL_ONLY', history_only_pending: historyOnlyPending.map(m => m.name), after_delta_pending: 0, satisfied_by_state: 4, student_api_update: 0, student_auth_update: 0, mutation_calls: 0 }, null, 2));
  console.log('PASS installer regression: pending 0; API/auth updates 0; mutation calls 0');
} finally { await db.close(); }
