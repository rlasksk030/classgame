import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readSource(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8");
}

// Teacher Page Expansion Phase 3C (수업 결과 요약). Aggregation
// correctness is covered by tests/teacher-results.test.ts (unit). This
// file covers what's only checkable by reading the actual shipped
// source: security guard, no polling, default lesson, label reuse, and
// the combined Phase 3A+3B+3C wiring (error isolation across all three
// new sections, nav ordering) that only makes sense once both halves of
// Phase 3 exist together.

test("teacher:results:summary verifies teacherOwnsClass before touching any data", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  const resultsBody = edge.match(/if \(action === "teacher:results:summary"\) \{[\s\S]*?\n {4}\}/)?.[0];
  assert.ok(resultsBody, "teacher:results:summary handler must exist");
  assert.match(resultsBody!, /teacherOwnsClass\(db, teacherId, classId\)/);
});

test("P. teacher:results:summary doesn't loop per-student -- one bulk .in(studentIds) query per table", async () => {
  const edge = await readSource("../supabase/functions/student-api/index.ts");
  const resultsBody = edge.match(/if \(action === "teacher:results:summary"\) \{[\s\S]*?\n {4}\}/)?.[0];
  assert.match(resultsBody!, /\.in\("student_id", studentIds\)/);
  assert.doesNotMatch(resultsBody!, /studentIds\.map\(async/);
});

test("결과 요약은 polling하지 않는다 -- 학급/차시 변경 시에만 fetch하고 setInterval을 쓰지 않는다", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  const loadResultsEffect = page.match(/useEffect\(\(\) => \{\s*if \(!classId \|\| resultsLesson === null\) return;\s*void loadResults\(classId, resultsLesson\);\s*\}, \[classId, resultsLesson, loadResults\]\);/)?.[0];
  assert.ok(loadResultsEffect, "results must fetch only on classId/resultsLesson change, no interval");
});

test("차시 선택 기본값은 학생 진도표에서 가장 많이 학습 중인 차시를 재사용한다 (별도 계산 없음)", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  assert.match(page, /setResultsLesson\(progressSummary\.mostCommonLesson \?\? 1\);/);
});

test("문제 유형 표시는 기존 PROBLEM_TYPE_LABELS 를 그대로 쓰고, 새 한글 라벨 목록을 따로 만들지 않는다", async () => {
  const resultsShared = await readSource("../shared/teacherResults.ts");
  assert.match(resultsShared, /import \{ PROBLEM_TYPE_LABELS, type ProblemType \} from "\.\/types\.ts";/);
  assert.doesNotMatch(resultsShared, /카메라|숫자 지도|층별 지도/, "no second hardcoded Korean label list in this file");
});

test("results failures render inside the results section only, via their own error state -- never the shared page-level error", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  assert.match(page, /const \[resultsError, setResultsError\]/);
  const resultsSection = page.match(/<section className="panel stack" id="results">[\s\S]*?<\/section>/)?.[0];
  assert.match(resultsSection!, /\{resultsError \? <p className="error" role="alert">/);
  const loadResultsBody = page.match(/const loadResults = useCallback\(async \(targetClassId: string, lesson: number\) => \{[\s\S]*?\n {2}\}, \[\]\);/)?.[0];
  assert.doesNotMatch(loadResultsBody!, /setError\(/);
});

test("R. nav exposes 수업 현황 -> 학생 진도 -> 수업 결과 in that order, alongside every pre-existing anchor", async () => {
  const page = await readSource("../src/pages/TeacherPage.tsx");
  const nav = page.match(/<nav className="teacher-nav"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav);
  const liveIdx = nav!.indexOf("#live-status");
  const progressIdx = nav!.indexOf("#progress");
  const resultsIdx = nav!.indexOf("#results");
  assert.ok(liveIdx >= 0 && progressIdx >= 0 && resultsIdx >= 0);
  assert.ok(liveIdx < progressIdx && progressIdx < resultsIdx, "수업 현황 -> 학생 진도 -> 수업 결과 순서");
  for (const existing of ["#classes", "#students", "#lessons", "#problem-bank", "#activities"]) {
    assert.match(nav!, new RegExp(existing));
  }
});
