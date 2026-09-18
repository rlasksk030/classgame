import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.resolve('supabase/migrations/202609130017_phase5_persistence.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');

test('phase 5 migration is additive and targets the existing sb schema', () => {
  assert.match(migration, /begin;[\s\S]*commit;/i);
  assert.doesNotMatch(migration, /drop\s+table|truncate\s+table|drop\s+column/i);
  for (const table of [
    'sb_student_created_problems', 'sb_peer_problem_attempts', 'sb_lesson_progress_records',
    'sb_practice_assignments', 'sb_project_exports', 'sb_student_lesson_reflections',
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`grant all on public\\.${table} to service_role`));
    assert.match(migration, new RegExp(`revoke all on public\\.${table} from anon`));
  }
});

test('phase 5 migration separates private validation and enforces ownership-safe uniqueness', () => {
  assert.match(migration, /public_problem_json\s+jsonb[\s\S]*hidden_validation_json\s+jsonb/);
  assert.match(migration, /unique \(installation_id, problem_id, problem_version, student_id\)/);
  assert.match(migration, /unique \(installation_id, idempotency_key\)/);
  assert.match(migration, /sb_practice_assignments_one_active_idx[\s\S]*where active/);
  assert.match(migration, /foreign key \(problem_id, problem_version\)[\s\S]*references public\.sb_student_created_problems\(problem_id, version\)/);
  assert.doesNotMatch(migration, /grant\s+all\s+on\s+public\.sb_[a-z_]+\s+to\s+anon/i);
  assert.doesNotMatch(migration, /grant\s+all\s+on\s+public\.sb_[a-z_]+\s+to\s+authenticated/i);
});

test('phase 5 project export metadata keeps version and does not create storage', () => {
  assert.match(migration, /add column if not exists project_id uuid/);
  assert.match(migration, /project_version\s+integer/);
  assert.match(migration, /export_type\s+text[\s\S]*'png','pdf'/);
  assert.doesNotMatch(migration, /create\s+(or replace\s+)?storage|insert\s+into\s+storage\.buckets/i);
});
