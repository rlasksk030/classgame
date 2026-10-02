import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/pages/TeacherPage.tsx', import.meta.url), 'utf8');

test('progress polling refreshes the progress API independently of session health', () => {
  const effect = source.match(/useEffect\(\(\) => \{\s*if \(!classId \|\| classDataLoading\) return;[\s\S]*?\n {2}\}, \[classId, classDataLoading, loadProgress\]\);/)?.[0];
  assert.ok(effect, 'the progress table needs its own refresh cycle');
  assert.match(effect, /loadProgress\(classId, true\)/);
  assert.match(effect, /setInterval\(poll, 10000\)/);
  assert.match(effect, /document\.hidden/);
  assert.match(effect, /clearInterval/);
  assert.doesNotMatch(effect, /loadSessions|setSessionsError/);
});

test('progress refresh preserves last valid rows on failure and ignores stale class responses', () => {
  const callback = source.match(/const loadProgress = useCallback\([\s\S]*?\n {2}\}, \[\]\);/)?.[0];
  assert.ok(callback);
  assert.match(callback, /classDataGenerationRef\.current !== generation/);
  assert.match(callback, /progressRequestRef\.current !== request/);
  assert.match(callback, /setProgressSummaryError\(classifyTeacherError\(err\)\)/);
  assert.doesNotMatch(callback, /setProgressStudents\(\[\]\)/);
});
