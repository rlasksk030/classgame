/** Synthetic auth/HTTP adapter; progress uses real migrations, grader, RPC and summary. */
import type { Page } from '@playwright/test';
import { deriveProblemPresentation } from '../../shared/problemPresentation.ts';
import { requiredSolveIds } from '../../shared/lessonProgression.ts';
import { INITIAL_ATTEMPT } from '../../shared/attempts.ts';
import { summarizeLessonResults, type ResultAttemptRow, type ResultProblemRow } from '../../shared/teacherResults.ts';
import type { BlockCoord, StudentSubmission } from '../../shared/types.ts';
import { CLASS, TEACHER, setupRequiredProgressDb, submitProblem, readTeacherSummary, type ProblemRow } from '../../tests/support/required-progress-db.ts';
import { API_ORIGIN, configureLivePage } from '../live-fixture';

export const PROGRESS_PIN = '4826';
export const TEACHER_EMAIL = 'required-progress@example.invalid';
export const TEACHER_PASSWORD = 'synthetic-browser-password';
type Row = Record<string, unknown>;
type PublicProblemRow = ProblemRow & {
  title: string; prompt: string; given_blocks: BlockCoord[]; start_blocks: BlockCoord[];
  choices: string[]; difficulty: 1 | 2 | 3; xp: number;
};

export async function requiredProgressApi() {
  const db = await setupRequiredProgressDb();
  const sessions = new Map<string, { id: string; class_id: string; name: string; student_no: number }>();
  const submissions: Array<{ studentId: string; problemId: string; correct: boolean }> = [];
  let summaryRequests = 0;
  let failSummary = false;
  const user = { id: TEACHER, email: TEACHER_EMAIL, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
  const accessToken = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: TEACHER, exp: 4070908800, role: 'authenticated' })).toString('base64url')}.synthetic`;
  const authSession = { access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'synthetic-refresh', user };
  const response = (value: unknown, status = 200) => Response.json(value, { status });
  const publicProblem = (p: PublicProblemRow) => {
    const grid = { gridWidth: p.grid_width, gridDepth: p.grid_depth, maxHeight: p.max_height };
    return { id: p.id, lesson: p.lesson, orderIndex: p.order_index,
      stage: p.order_index <= 1 ? 'concept' : p.order_index === 2 ? 'check' : 'more',
      problemType: p.problem_type, title: p.title, prompt: p.prompt,
      givenBlocks: p.given_blocks, startBlocks: p.start_blocks, given: p.given, choices: p.choices,
      grid, difficulty: p.difficulty, xp: p.xp, hint: null,
      presentation: deriveProblemPresentation({ problemType: p.problem_type, grid, given: p.given, answer: p.answer }) };
  };

  async function request(url: string, body: Row, headers: Record<string, string>) {
    const path = new URL(url).pathname;
    if (path.endsWith('/auth/v1/token')) return response(authSession);
    if (path.endsWith('/auth/v1/user')) return response(user);
    if (path.endsWith('/auth/v1/logout')) return response({});
    if (path.startsWith('/rest/v1/') && headers.authorization === `Bearer ${accessToken}`) {
      const params = new URL(url).searchParams;
      const studentId = params.get('student_id')?.replace(/^eq\./, '');
      if (path.endsWith('/sb_students')) return response((await db.query('select name,class_id from sb_students where id=$1 and class_id=$2', [params.get('id')?.replace(/^eq\./, ''), CLASS])).rows[0]);
      if (path.endsWith('/sb_block_snapshots')) return response((await db.query('select b.* from sb_block_snapshots b join sb_students s on s.id=b.student_id where b.student_id=$1 and s.class_id=$2 order by b.lesson', [studentId, CLASS])).rows);
      if (path.endsWith('/sb_problem_attempts')) return response((await db.query("select a.*,json_build_object('id',p.id,'lesson',p.lesson,'order_index',p.order_index) as sb_problems from sb_problem_attempts a join sb_problems p on p.id=a.problem_id join sb_students s on s.id=a.student_id where a.student_id=$1 and s.class_id=$2 order by a.id", [studentId, CLASS])).rows);
      if (path.endsWith('/sb_student_progress')) return response((await db.query('select p.* from sb_student_progress p join sb_students s on s.id=p.student_id where p.student_id=$1 and s.class_id=$2 order by p.updated_at desc', [studentId, CLASS])).rows);
      if (path.endsWith('/sb_student_rewards')) return response((await db.query('select r.* from sb_student_rewards r join sb_students s on s.id=r.student_id where r.student_id=$1 and s.class_id=$2', [studentId, CLASS])).rows);
      if (path.endsWith('/sb_problems')) return response((await db.query('select id,lesson,order_index from sb_problems where active and order_index=2 and (class_id is null or class_id=$1) order by id', [CLASS])).rows);
      if (path.endsWith('/sb_shared_challenges')) return response((await db.query('select * from sb_shared_challenges where class_id=$1', [CLASS])).rows);
      if (path.endsWith('/sb_projects')) return response((await db.query('select * from sb_projects where class_id=$1 and ($2::uuid is null or student_id=$2)', [CLASS, studentId ?? null])).rows);
      if (path.endsWith('/sb_challenge_solves')) return response((await db.query('select s.* from sb_challenge_solves s join sb_shared_challenges c on c.id=s.challenge_id where c.class_id=$1', [CLASS])).rows);
    }
    if (path.endsWith('/student-auth')) {
      if (body.classCode !== 'REQPROGRESS') return response({ error: { code: 'CLASS_NOT_FOUND', message: '합성 학급 없음' } }, 404);
      if (body.action === 'class') return response({ classId: CLASS, className: '합성 진도 검증반' });
      const student = (await db.query<{ id: string; class_id: string; name: string; student_no: number }>('select id,class_id,name,student_no from sb_students where class_id=$1 and name=$2', [CLASS, body.name])).rows[0];
      if (!student || body.pin !== PROGRESS_PIN) return response({ error: { code: 'PIN_INVALID', message: '합성 로그인 정보 확인' } }, 401);
      const token = `${Buffer.from(JSON.stringify({ sid: student.id, cid: student.class_id })).toString('base64url')}.synthetic`;
      sessions.set(token, student);
      return response({ token, expiresAt: '2099-01-01', student: { id: student.id, name: student.name, studentNo: student.student_no, classId: CLASS, className: '합성 진도 검증반' } });
    }
    const action = String(body.action);
    if (action.startsWith('teacher:')) {
      if (headers.authorization !== `Bearer ${accessToken}`) return response({ error: { code: 'TEACHER_AUTH', message: '합성 교사 인증 필요' } }, 401);
      if (action === 'teacher:classes') return response({ classes: (await db.query('select id,name,class_code from sb_classes where id=$1', [CLASS])).rows });
      if (body.classId !== CLASS) return response({ error: { code: 'FORBIDDEN_CLASS', message: '합성 학급 접근 불가' } }, 403);
      if (action === 'teacher:students:list') return response({ students: (await db.query('select id,name,student_no,status,failed_attempts as "failedAttempts",locked_until as "lockedUntil",created_at as "createdAt" from sb_students where class_id=$1', [CLASS])).rows.map(row => ({ ...row, pinPlain: PROGRESS_PIN })) });
      if (action === 'teacher:lessons:list') return response({ lessons: (await db.query('select * from sb_lesson_settings where class_id=$1 order by lesson', [CLASS])).rows });
      if (action === 'teacher:problems:list') return response({ customProblems: [], builtinCount: Number((await db.query<{ count: number }>('select count(*) from sb_problems')).rows[0].count) });
      if (action === 'teacher:sessions:list') return response({ students: [] });
      if (action === 'teacher:peer-problem:list') return response({ problems: [] });
      if (action === 'teacher:results:summary') {
        const lesson = Number(body.lesson);
        const students = await readTeacherSummary(db);
        const attempts = (await db.query<ResultAttemptRow>('select a.student_id,a.problem_id,a.wrong_count from sb_problem_attempts a join sb_students s on s.id=a.student_id where s.class_id=$1 and a.lesson=$2', [CLASS, lesson])).rows;
        const problems = (await db.query<ResultProblemRow>('select distinct p.id,p.problem_type,p.code from sb_problems p join sb_problem_attempts a on a.problem_id=p.id join sb_students s on s.id=a.student_id where s.class_id=$1 and a.lesson=$2', [CLASS, lesson])).rows;
        const progress = students.map(student => ({ student_id: student.studentId, completed: student.lessonStates[lesson - 1] === 'complete' }));
        return response({ summary: summarizeLessonResults(lesson, students.length, attempts, progress, problems) });
      }
      if (action === 'teacher:progress:summary') {
        summaryRequests++;
        if (failSummary) return response({ error: { code: 'PROGRESS_LOAD_FAILED', message: '합성 일시적 조회 실패' } }, 503);
        return response({ students: await readTeacherSummary(db) });
      }
    }
    const student = sessions.get(headers['x-student-token'] ?? '');
    if (!student) return response({ error: { code: 'SESSION_INVALID', message: '합성 학생 로그인 필요' } }, 401);
    if (action === 'home') {
      const summary = (await readTeacherSummary(db)).find(s => s.studentId === student.id)!;
      return response({ student: { classId: CLASS, className: '합성 진도 검증반', rewards: { totalXp: 0, totalStars: 0, badges: [], streak: 0 }, lessons: summary.lessonStates.map((state, i) => ({ lesson: i + 1, locked: false, completed: state === 'complete', totalProblems: 1, completedProblems: Number(state === 'complete'), stars: 0 })) } });
    }
    if (action === 'lessonProblems') {
      const lesson = Number(body.lesson);
      if (body.markGuidedComplete !== false) await db.query('insert into sb_student_progress(student_id,lesson,guided_completed) values($1,$2,true) on conflict(student_id,lesson) do update set guided_completed=true', [student.id, lesson]);
      const rows = (await db.query<PublicProblemRow>('select * from sb_problems where active and lesson=$1 and (class_id is null or class_id=$2) order by order_index,id', [lesson, CLASS])).rows;
      const problems = rows.map(publicProblem);
      const done = new Set((await db.query<{ problem_id: string }>('select problem_id from sb_problem_attempts where student_id=$1 and lesson=$2 and completed', [student.id, lesson])).rows.map(r => r.problem_id));
      const required = requiredSolveIds(problems);
      const requiredComplete = required.length > 0 && required.every(id => done.has(id));
      const saved = (await db.query<{ guided_completed: boolean; last_problem_id: string }>('select guided_completed,last_problem_id from sb_student_progress where student_id=$1 and lesson=$2', [student.id, lesson])).rows[0];
      return response({ problems, seedFallback: false, requiredComplete, currentStage: saved?.guided_completed ? requiredComplete ? 'optional' : 'required' : 'guided', currentProblemId: saved?.last_problem_id ?? required[0], allowSimilar: true, allowRetry: true });
    }
    if (action === 'problem') {
      const p = (await db.query<PublicProblemRow>('select * from sb_problems where id=$1', [body.problemId])).rows[0];
      const a = (await db.query<{ wrong_count: number; hint_shown: boolean; answer_revealed: boolean; completed: boolean }>('select * from sb_problem_attempts where student_id=$1 and problem_id=$2', [student.id, body.problemId])).rows[0];
      return response({ problem: publicProblem(p), attempt: a ? { wrongCount: a.wrong_count, hintShown: a.hint_shown, answerRevealed: a.answer_revealed, completed: a.completed } : INITIAL_ATTEMPT, hint: null, revealedAnswer: null });
    }
    if (action === 'snapshot:get') return response({ snapshot: (await db.query('select blocks from sb_block_snapshots where student_id=$1 and problem_id=$2', [student.id, body.problemId])).rows[0] ?? null });
    if (action === 'snapshot') {
      await db.query('insert into sb_block_snapshots(student_id,problem_id,lesson,blocks,grid_width,grid_depth,max_height) values($1,$2,$3,$4,$5,$6,$7) on conflict(student_id,problem_id) do update set blocks=excluded.blocks', [student.id, body.problemId, body.lesson, body.blocks, body.gridWidth, body.gridDepth, body.maxHeight]);
      return response({ ok: true });
    }
    if (action === 'position') { await db.query('insert into sb_student_progress(student_id,lesson,last_problem_id) values($1,$2,$3) on conflict(student_id,lesson) do update set last_problem_id=excluded.last_problem_id', [student.id, body.lesson, body.problemId]); return response({ ok: true }); }
    if (action === 'attempt') {
      const payload = body.submission as StudentSubmission & { direction?: string };
      // The student HTTP contract sends `direction`; the grader consumes `value`.
      const submission = payload.kind === 'direction' && payload.direction
        ? { kind: 'direction', value: payload.direction } as StudentSubmission : payload;
      const { verdict, outcome } = await submitProblem(db, student.id, String(body.problemId), submission);
      submissions.push({ studentId: student.id, problemId: String(body.problemId), correct: verdict.correct });
      return response({ grade: { correct: verdict.correct, ...outcome.state, message: outcome.message, xpEarned: outcome.xpEarned, stars: outcome.stars, hint: null, revealedAnswer: null } });
    }
    return response({ error: { code: 'SYNTHETIC_UNHANDLED', message: action } }, 400);
  }
  async function connect(page: Page) {
    await configureLivePage(page);
    await page.route(`${API_ORIGIN}/**`, async route => {
      const req = route.request();
      const result = await request(req.url(), req.postData() ? req.postDataJSON() : {}, req.headers());
      await route.fulfill({ status: result.status, contentType: 'application/json', body: await result.text() });
    });
  }
  return { db, connect, submissions, get summaryRequests() { return summaryRequests; }, setSummaryFailure(value: boolean) { failSummary = value; }, close: () => db.close() };
}
