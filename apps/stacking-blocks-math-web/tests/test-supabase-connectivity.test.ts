import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const example = fs.readFileSync(".env.test.example", "utf8");
const script = fs.readFileSync("scripts/verify-test-supabase.ts", "utf8");
const runner = fs.readFileSync("scripts/run-phase5b-test.mjs", "utf8");
const ignore = fs.readFileSync(".gitignore", "utf8");

test("TEST Supabase configuration is isolated from Vite production env", () => {
  for (const name of ["TARGET_ENV", "SUPABASE_TEST_PROJECT_REF", "SUPABASE_TEST_URL", "SUPABASE_TEST_PUBLISHABLE_KEY"]) {
    assert.match(example, new RegExp(`^${name}=`, "m"));
  }
  assert.match(example, /SUPABASE_TEST_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(example, /VITE_SUPABASE_TEST_SERVICE_ROLE_KEY/);
  assert.match(ignore, /^\.env\.test\.local$/m);
});

test("TEST connectivity command fails closed before any remote write", () => {
  assert.match(script, /TARGET_ENV.*TEST/);
  assert.match(script, /PRODUCTION_TARGET_BLOCKED/);
  assert.match(script, /SUPABASE_TEST_PROJECT_REF/);
  assert.match(script, /auth\/v1\/settings/);
  assert.doesNotMatch(script, /insert|update|delete|create table|migration/i);
  assert.doesNotMatch(script, /console\.log\([^\n]*(publishableKey|service_role|secret|password)/i);
});

test("Phase 5B Mac runner has an explicit TEST target and confirmation gate", () => {
  assert.match(runner, /TARGET_ENV.*TEST/);
  assert.match(runner, /PRODUCTION_TARGET_BLOCKED/);
  assert.match(runner, /Type APPLY_TO_TEST to continue/);
  assert.match(runner, /--project-ref/);
  assert.match(runner, /tempSupabaseRoot/);
  assert.match(runner, /functions.*deploy.*student-auth/);
  assert.doesNotMatch(runner, /SUPABASE_TEST_SERVICE_ROLE_KEY[^\n]*console\.(log|error)/i);
});

test("Phase 5B runner prefers project CLI, then no-install npx, then global CLI", () => {
  const runner = fs.readFileSync("scripts/run-phase5b-test.mjs", "utf8");
  assert.match(runner, /node_modules.*\.bin.*supabase/);
  assert.match(runner, /npx.*--no-install.*supabase/);
  assert.match(runner, /spawnSync\("supabase"/);
  assert.match(runner, /SUPABASE_CLI_MISSING/);
});

test("TEST IPv4 link runs in the temporary workspace before db push", () => {
  const runner = fs.readFileSync("scripts/run-phase5b-test.mjs", "utf8");
  assert.match(runner, /linkTestWorkspace/);
  assert.match(runner, /link.*--project-ref/);
  assert.match(runner, /TEST_LINK_FAILED/);
  assert.ok(runner.indexOf("linkTestWorkspace(t.ref, temp)") < runner.indexOf('run("supabase", ["db", "push"'));
  assert.match(runner, /productionLinkSnapshot/);
  assert.match(runner, /PRODUCTION_LINK_CHANGED/);
});
