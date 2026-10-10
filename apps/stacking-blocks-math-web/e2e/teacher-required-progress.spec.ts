import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './live-fixture';
import { requiredProgressApi, PROGRESS_PIN, TEACHER_EMAIL, TEACHER_PASSWORD } from './support/required-progress-api';
import { STUDENTS, REQUIRED_LESSONS, solveRequiredLesson, submitProblem, completeActivityLessons, readTeacherSummary } from '../tests/support/required-progress-db.ts';

async function studentLogin(page: Page, name = '합성학생1') {
  await page.goto('/?class=REQPROGRESS');
  await page.getByLabel('이름', { exact: true }).fill(name);
  await page.getByLabel('PIN 4자리').fill(PROGRESS_PIN);
  await page.getByRole('button', { name: '들어가기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '공간과 입체 월드', exact: true })).toBeVisible();
}
async function teacherLogin(page: Page) {
  await page.goto('/teacher');
  await page.getByLabel('이메일', { exact: true }).fill(TEACHER_EMAIL);
  await page.getByLabel('비밀번호', { exact: true }).fill(TEACHER_PASSWORD);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.locator('#progress').getByRole('heading', { name: '학생 진도', exact: true })).toBeVisible();
}
const studentRow = (page: Page, number: number) => page.locator('#progress tbody tr').filter({ has: page.getByRole('link', { name: `합성학생${number}`, exact: true }) });

test('required progress persists through real UI submission, polling, reloads and separate teacher sessions', async ({ page, browser }) => {
  test.setTimeout(120000);
  const api = await requiredProgressApi();
  const contexts: BrowserContext[] = [];
  try {
    await api.connect(page);
    await studentLogin(page);
    const teacherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' }); contexts.push(teacherContext);
    const teacher = await teacherContext.newPage(); await api.connect(teacher); await teacherLogin(teacher);
    await expect(studentRow(teacher, 1).getByRole('cell', { name: '0/12', exact: true })).toBeVisible();

    // Real student LessonPage input -> actual shared grader -> new PostgreSQL RPC.
    const requestsBeforeSubmit = api.summaryRequests;
    await page.goto('/lesson/1/solve');
    await page.getByPlaceholder('전체 개수', { exact: true }).fill('5');
    await page.getByRole('button', { name: '정답 확인', exact: true }).click();
    await expect(page.getByRole('button', { name: '② 문제 풀기 · 완료', exact: true })).toBeVisible();
    expect(api.submissions).toHaveLength(1); expect(api.submissions[0].correct).toBe(true);
    expect((await api.db.query<{answer:unknown}>('select answer from sb_lesson_progress_records where student_id=$1 and lesson=1', [STUDENTS[0]])).rows.map(r => r.answer)).toEqual([{kind:'count',value:5}]);
    expect((await api.db.query<{ completed: boolean }>('select completed from sb_student_progress where student_id=$1 and lesson=1', [STUDENTS[0]])).rows[0].completed).toBe(true);
    await teacher.bringToFront();
    await expect(studentRow(teacher, 1).getByRole('cell', { name: '1/12', exact: true })).toBeVisible({ timeout: 15000 });
    expect(api.summaryRequests).toBeGreaterThan(requestsBeforeSubmit);

    await page.goto('/lesson/2/solve');
    await page.getByRole('button', { name: '위', exact: true }).click();
    await page.getByRole('button', { name: '정답 확인', exact: true }).click();
    await expect(page.getByRole('button', { name: '② 문제 풀기 · 완료', exact: true })).toBeVisible();
    await page.goto('/lesson/5/solve');
    await page.getByRole('button', { name: '1. 앞에서 보면 뒤쪽에 놓인 쌓기나무가 가려져 보이지 않기 때문', exact: true }).click();
    await page.getByRole('button', { name: '정답 확인', exact: true }).click();
    await expect(page.getByRole('button', { name: '② 문제 풀기 · 완료', exact: true })).toBeVisible();
    expect(api.submissions).toHaveLength(3);
    expect(api.submissions.every(submission => submission.correct)).toBe(true);
    await teacher.getByRole('button', { name: '진도 새로고침', exact: true }).click();
    await expect(studentRow(teacher, 1).getByRole('cell', { name: '3/12', exact: true })).toBeVisible();
    await page.goto('/lesson/2/practice');
    await page.getByRole('button', { name: '오른쪽', exact: true }).click();
    await page.getByRole('button', { name: '정답 확인', exact: true }).click();
    await expect(page.getByText(/완료 \+ XP/)).toBeVisible();
    expect(api.submissions).toHaveLength(4);
    expect(api.submissions[3].correct).toBe(true);
    await teacher.getByRole('button', { name: '진도 새로고침', exact: true }).click();
    await expect(studentRow(teacher, 1).getByRole('cell', { name: '3/12', exact: true })).toBeVisible();
    expect((await readTeacherSummary(api.db))[0].optionalPracticeCount).toBe(1);
    await teacher.getByRole('button', { name: '결과 새로고침', exact: true }).click();
    await expect(teacher.locator('#results').getByText('완료율 33%', { exact: true })).toBeVisible();
    await expect(teacher.locator('#results').getByText('0회', { exact: true })).toBeVisible();
    api.setSummaryFailure(true);
    await teacher.getByRole('button', { name: '진도 새로고침', exact: true }).click();
    await expect(teacher.locator('#progress').getByRole('alert')).toContainText('진도 정보를 불러오지 못했습니다');
    await expect(studentRow(teacher, 1).getByRole('cell', { name: '3/12', exact: true })).toBeVisible();
    api.setSummaryFailure(false);
    await teacher.getByRole('button', { name: '진도 새로고침', exact: true }).click();
    await expect(teacher.locator('#progress').getByRole('alert')).toHaveCount(0);

    await page.goto('/lesson/1/solve'); await page.reload(); await expect(page.getByText('이 문제는 이미 완료했습니다.', { exact: true })).toBeVisible();
    await page.goto('/world'); await page.getByRole('button', { name: '나가기', exact: true }).click();
    await studentLogin(page); await page.goto('/lesson/1/solve');
    await expect(page.getByRole('button', { name: '정답 확인', exact: true })).toBeDisabled();
    await expect(page.getByPlaceholder('전체 개수', { exact: true })).toHaveValue('5');
    await teacher.reload(); await expect(studentRow(teacher, 1).getByRole('cell', { name: '3/12', exact: true })).toBeVisible();
    await teacher.getByRole('button', { name: '교사 로그아웃', exact: true }).click();
    await teacherLogin(teacher); await expect(studentRow(teacher, 1).getByRole('cell', { name: '3/12', exact: true })).toBeVisible();
    const newTeacherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' }); contexts.push(newTeacherContext);
    const newTeacher = await newTeacherContext.newPage(); await api.connect(newTeacher); await teacherLogin(newTeacher);
    await expect(studentRow(newTeacher, 1).getByRole('cell', { name: '3/12', exact: true })).toBeVisible();
    await studentRow(newTeacher, 1).getByRole('link', { name: '합성학생1', exact: true }).click();
    await expect(newTeacher.getByRole('heading', { name: '합성학생1 학생의 쌓기 기록', exact: true })).toBeVisible();
    await expect(newTeacher.getByText(/완료 차시: 1, 2, 5/)).toBeVisible();
    await expect(newTeacher.getByText(/더 풀어보기 풀이 1문제 · 완료 1문제/)).toBeVisible();
    await expect(newTeacher.getByRole('alert')).toHaveCount(0);
  } finally { for (const context of contexts) await context.close(); await api.close(); }
});

test('independent A/B/C database records render exact 1/12, 5/12 and 12/12 totals', async ({ page, browser }) => {
  test.setTimeout(120000);
  const api = await requiredProgressApi();
  try {
    await solveRequiredLesson(api.db, STUDENTS[0], 1);
    for (const lesson of [1, 2, 3, 4, 5]) await solveRequiredLesson(api.db, STUDENTS[1], lesson);
    for (const lesson of REQUIRED_LESSONS) await solveRequiredLesson(api.db, STUDENTS[2], lesson);
    await completeActivityLessons(api.db, STUDENTS[2]);
    expect((await readTeacherSummary(api.db)).map(row => row.requiredProgress.completedLessons)).toEqual([1, 5, 12]);
    await api.connect(page); await teacherLogin(page);
    for (const [number, count] of [[1, 1], [2, 5], [3, 12]]) await expect(studentRow(page, number).getByRole('cell', { name: `${count}/12`, exact: true })).toBeVisible();
    await expect(page.locator('#results').getByText('완료율 100%', { exact: true })).toBeVisible();
    await page.locator('#progress').scrollIntoViewIfNeeded();
    await page.locator('#progress').screenshot({ path: 'test-results/teacher-required-progress.png' });
    const studentContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' });
    try {
      const student = await studentContext.newPage(); await api.connect(student); await studentLogin(student, '합성학생3');
      await expect(student.getByText('필수 학습 진행률 100% · 완료 12/12차시', { exact: true })).toBeVisible();
      await student.reload();
      await expect(student.getByText('필수 학습 진행률 100% · 완료 12/12차시', { exact: true })).toBeVisible();
    } finally { await studentContext.close(); }
  } finally { await api.close(); }
});

test('world separates required work from the selected practice seed and restores it on a new student device', async ({ page, browser }) => {
  const api = await requiredProgressApi();
  const contexts: BrowserContext[] = [];
  try {
    for (const lesson of [1, 2]) await solveRequiredLesson(api.db, STUDENTS[0], lesson);
    const ids: string[] = [];
    for (const [seed, count] of [[111, 7], [222, 3]]) for (let i = 0; i < count; i++) {
      const row = (await api.db.query<{id:string}>("insert into sb_problems(code,lesson,order_index,problem_type,title,answer) values($1,1,$2,'COUNT','합성 선택 연습',$3) returning id", [`GEN-L1-S${seed}-${i}-V2`, 100+i, {kind:'count',value:1}])).rows[0];
      if (seed === 111) { ids.push(row.id); await submitProblem(api.db, STUDENTS[0], row.id); }
    }
    await api.db.query('update sb_student_progress set practice_seed=111 where student_id=$1 and lesson=1', [STUDENTS[0]]);
    await api.connect(page); await studentLogin(page);
    const card = page.locator('.lesson-card').filter({has:page.getByRole('heading',{name:/^1차시 ·/})});
    await expect(page.getByText('필수 학습 진행률 17% · 완료 2/12차시', {exact:true})).toBeVisible();
    await expect(card.getByText('필수 1/1문제', {exact:true})).toBeVisible();
    await expect(card.getByText('현재 선택 연습 7/8문제', {exact:true})).toBeVisible();
    // Change only the persisted assignment, as a new-set transition does. Old answers remain.
    await api.db.query('update sb_student_progress set practice_seed=222 where student_id=$1 and lesson=1', [STUDENTS[0]]);
    await page.reload();
    await expect(card.getByText('현재 선택 연습 0/4문제', {exact:true})).toBeVisible();
    await expect(page.getByText('필수 학습 진행률 17% · 완료 2/12차시', {exact:true})).toBeVisible();
    expect((await readTeacherSummary(api.db))[0].optionalPracticeCount).toBe(7);
    expect((await api.db.query('select 1 from sb_problem_attempts where student_id=$1 and problem_id=any($2::uuid[]) and completed',[STUDENTS[0],ids])).rows).toHaveLength(7);
    const newContext = await browser.newContext({baseURL:'http://127.0.0.1:4173'}); contexts.push(newContext);
    const newStudent = await newContext.newPage(); await api.connect(newStudent); await studentLogin(newStudent);
    await expect(newStudent.locator('.lesson-card').filter({has:newStudent.getByRole('heading',{name:/^1차시 ·/})}).getByText('현재 선택 연습 0/4문제', {exact:true})).toBeVisible();
    await expect(newStudent.getByText('필수 학습 진행률 17% · 완료 2/12차시', {exact:true})).toBeVisible();
    await page.screenshot({path:'test-results/student-world-progress-contract.png',fullPage:true});
  } finally { for (const context of contexts) await context.close(); await api.close(); }
});
