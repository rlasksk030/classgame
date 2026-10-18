import type { Page } from '@playwright/test';
import { test, expect, configureLivePage } from './live-fixture';

const paletteName = '쌓기나무 보관함. 블록을 작업판에 놓기';
const base = { lesson: 1, grid: { gridWidth: 4, gridDepth: 4, maxHeight: 4 }, givenBlocks: [], startBlocks: [], given: { allowRotate: true }, choices: [], gradingMode: 'exact' };
const problems = [
  { ...base, id: 'concept-1', stage: 'concept', orderIndex: 1, problemType: 'COUNT', title: '개념 복습 문제', prompt: '블록은 몇 개인가요?' },
  { ...base, id: 'required-1', stage: 'check', orderIndex: 2, problemType: 'COUNT', title: '필수 개수 문제', prompt: '블록은 몇 개인가요?' },
  { ...base, id: 'optional-1', stage: 'more', orderIndex: 3, problemType: 'FREE_BUILD', title: '선택 쌓기 문제', prompt: '블록을 직접 쌓아 보세요.' },
];
async function connect(page: Page, initial: 'new' | 'partial' | 'complete' = 'complete') {
  await configureLivePage(page);
  await page.addInitScript(() => localStorage.setItem('sb.student.token', btoa(JSON.stringify({sid: 'synthetic-a', cid: 'synthetic-class'})) + '.test'));
  let guided = initial !== 'new', complete = initial === 'complete';
  let cursor = complete ? 'optional-1' : 'required-1';
  let blocks: unknown[] = [];
  const mutations: string[] = [];
  const requests: { action: string; markGuidedComplete?: boolean }[] = [];
  await page.route('**/functions/v1/student-api', async route => {
    const b = route.request().postDataJSON(); requests.push(b);
    let data: unknown = {};
    switch (b.action) {
      case 'lessonProblems':
        if (b.markGuidedComplete !== false) guided = true;
        data = { problems, requiredComplete: complete, currentStage: !guided ? 'guided' : !complete ? 'required' : 'optional', currentProblemId: cursor, seedFallback: false }; break;
      case 'problem': data = { problem: problems.find(p => p.id === b.problemId), attempt: {wrongCount: 0, hintShown: false, answerRevealed: false, completed: b.problemId === 'required-1' && complete}, hint: null }; break;
      case 'snapshot:get': data = { snapshot: { blocks } }; break;
      case 'progress:get': data = { progress: [] }; break;
      case 'position': cursor = b.problemId; mutations.push(b.action); break;
      case 'snapshot': blocks = structuredClone(b.blocks); mutations.push(b.action); break;
      case 'attempt': complete = true; mutations.push(b.action); data = {grade: {correct: true, completed: true, wrongCount: 0, xpEarned: 30, stars: 3, message: '정답이에요.'}}; break;
      default: mutations.push(b.action);
    }
    await route.fulfill({json: data});
  });
  return { mutations, requests, saved: () => blocks, progress: () => ({guided, complete, cursor}) };
}
async function readyBuild(page: Page) {
  const state = await connect(page);
  await page.goto('/lesson/1/practice');
  await expect(page.getByRole('button', {name: paletteName})).toBeVisible();
  await page.getByRole('button', {name: '위에서 보기', exact: true}).click();
  await page.waitForTimeout(400); // camera preset animation
  await page.getByRole('button', {name: paletteName}).scrollIntoViewIfNeeded();
  return state;
}

test('review: explicit ③ → ① stays on guided exploration after server resume and reload, without progress writes', async ({page}) => {
  const state = await connect(page);
  await page.goto('/lesson/1/practice');
  await expect(page.getByRole('button', {name: paletteName})).toBeVisible();
  const before = state.progress();
  await page.getByRole('button', {name: '① 개념 배우기', exact: true}).click();
  await expect(page.getByRole('region', {name: '안내된 탐구'})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', {name: '안내된 탐구'})).toBeVisible();
  expect(state.progress()).toEqual(before);
  expect(state.mutations).toEqual([]);
});

test('touch: a short palette tap with finger jitter still arms the next board tap', async ({browser, browserName}) => {
  test.skip(browserName !== 'chromium', 'Trusted touch jitter/cancel uses Chromium CDP; physical tablets remain NOT_VERIFIED.');
  const context = await browser.newContext({baseURL: 'http://127.0.0.1:4173', viewport: {width: 1024, height: 768}, hasTouch: true, deviceScaleFactor: 2});
  try {
    const page = await context.newPage(); await readyBuild(page);
    const palette = (await page.getByRole('button', {name: paletteName}).boundingBox())!;
    const board = (await page.getByLabel('쌓기나무 3D 작업판').boundingBox())!;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: palette.x + 30, y: palette.y + 30}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: palette.x + 38, y: palette.y + 30}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await page.touchscreen.tap(board.x + board.width / 2, board.y + board.height / 2);
    await expect(page.getByText('블록 수: 1', {exact: true})).toBeVisible();
  } finally { await context.close(); }
});

test('pointer: releasing outside without a final move must discard the last valid drop candidate', async ({page, browserName}) => {
  test.skip(browserName !== 'chromium', 'Release-coordinate injection uses Chromium CDP.');
  await readyBuild(page);
  const palette = (await page.getByRole('button', {name: paletteName}).boundingBox())!;
  const board = (await page.getByLabel('쌓기나무 3D 작업판').boundingBox())!;
  await page.mouse.move(palette.x + 25, palette.y + 25); await page.mouse.down();
  await page.mouse.move(board.x + board.width / 2, board.y + board.height / 2);
  await expect(page.getByText('놓을 수 있어요.', {exact: true})).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: 2, y: 2, button: 'left', clickCount: 1});
  await expect(page.getByText('블록 수: 0', {exact: true})).toBeVisible();
});

test('stages: new and partially complete students resume correctly; required work gates optional practice', async ({page}) => {
  const state = await connect(page, 'new');
  await page.goto('/lesson/1/learn');
  await expect(page.getByRole('region', {name: '안내된 탐구'})).toBeVisible();
  expect(state.progress().guided).toBe(false);
  await expect(page.getByRole('button', {name: /③ 선택 연습으로 이동/})).toBeDisabled();
  await page.getByRole('button', {name: '② 문제 풀기 시작'}).click();
  await expect(page).toHaveURL(/\/solve$/);
  await expect(page.getByRole('button', {name: /③ 선택 연습/})).toBeDisabled();
  await page.reload();
  await expect(page.getByText('필수 개수 문제', {exact: true})).toBeVisible();
  await page.goto('/lesson/1/learn'); // default entry resumes server progress
  await expect(page).toHaveURL(/\/solve$/);
  await page.goto('/lesson/1/practice'); // direct URL does not bypass required work
  await expect(page).toHaveURL(/\/solve$/);
  await page.getByPlaceholder('전체 개수', {exact: true}).fill('0');
  await page.getByRole('button', {name: '정답 확인', exact: true}).click();
  await expect(page.getByRole('button', {name: '③ 선택 연습', exact: true})).toBeEnabled();
  await page.getByRole('button', {name: '③ 선택 연습', exact: true}).click();
  await expect(page).toHaveURL(/\/practice$/);
  await page.goto('/lesson/1/learn');
  await expect(page).toHaveURL(/\/practice$/);
  expect(state.mutations.filter(x => x === 'attempt')).toHaveLength(1);
});

test('review: concept questions are read-only, do not award XP, and preserve saved resume position', async ({page}) => {
  const state = await connect(page);
  await page.goto('/lesson/1/learn?review=1');
  await page.getByRole('button', {name: '개념 문제 살펴보기'}).click();
  await expect(page.getByText('개념 복습 문제', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: '정답 확인', exact: true})).toBeDisabled();
  await expect(page.getByPlaceholder('전체 개수', {exact: true})).toBeDisabled();
  await page.reload();
  await expect(page.getByText('개념 복습 문제', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: '① 개념 배우기', exact: true}).click();
  await expect(page.getByRole('region', {name: '안내된 탐구'})).toBeVisible();
  expect(state.mutations).toEqual([]);
  expect(state.requests.filter(r => r.action === 'lessonProblems').every(r => r.markGuidedComplete === false)).toBe(true);
  expect(state.progress()).toEqual({guided: true, complete: true, cursor: 'optional-1'});
  await page.screenshot({path: 'test-results/review-guided.png', fullPage: true});
});

test('touch: two taps stack two levels; select, button move/delete, save and reload preserve blocks', async ({browser}) => {
  const context = await browser.newContext({baseURL: 'http://127.0.0.1:4173', viewport: {width: 1024, height: 900}, hasTouch: true, deviceScaleFactor: 2});
  try {
    const page = await context.newPage(), state = await readyBuild(page);
    const palette = page.getByRole('button', {name: paletteName});
    const board = (await page.getByLabel('쌓기나무 3D 작업판').boundingBox())!;
    // Pick inside a cell; the exact board centre is a four-cell grid intersection.
    const point = {x: board.x + board.width / 2 + 24, y: board.y + board.height / 2 + 24};
    for (const count of [1, 2]) {
      await palette.tap(); await page.touchscreen.tap(point.x, point.y);
      await expect(page.getByText(`블록 수: ${count}`, {exact: true})).toBeVisible();
    }
    await page.getByRole('button', {name: '저장', exact: true}).click();
    await expect.poll(() => state.saved().length).toBe(2);
    expect((state.saved() as {y: number}[]).map(b => b.y)).toEqual([0, 1]);
    await page.getByLabel('쌓기나무 3D 작업판').scrollIntoViewIfNeeded();
    const selectionBoard = (await page.getByLabel('쌓기나무 3D 작업판').boundingBox())!;
    await page.touchscreen.tap(selectionBoard.x + selectionBoard.width / 2 + 24, selectionBoard.y + selectionBoard.height / 2 + 24); // select without moving
    await expect(page.getByRole('button', {name: '선택 블록 삭제'})).toBeEnabled();
    await page.getByText('버튼으로 놓기', {exact: true}).click();
    await page.getByLabel('가로', {exact: true}).fill('1');
    await page.getByLabel('세로', {exact: true}).fill('1');
    await page.getByRole('button', {name: '선택 블록 옮기기'}).click();
    await expect(page.getByText('블록 수: 2', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: '쌓기', exact: true}).click();
    await expect(page.getByText('블록 수: 3', {exact: true})).toBeVisible();
    // Original centre column has one remaining block; delete it by touch selection.
    await page.getByLabel('쌓기나무 3D 작업판').scrollIntoViewIfNeeded();
    const finalBoard = (await page.getByLabel('쌓기나무 3D 작업판').boundingBox())!;
    await page.touchscreen.tap(finalBoard.x + finalBoard.width / 2 + 24, finalBoard.y + finalBoard.height / 2 + 24);
    await page.getByRole('button', {name: '선택 블록 삭제'}).click();
    await expect(page.getByText('블록 수: 2', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: '저장', exact: true}).click();
    await expect.poll(() => state.saved().length).toBe(2);
    const saved = structuredClone(state.saved());
    await page.reload();
    await expect(page.getByText('블록 수: 2', {exact: true})).toBeVisible();
    expect(state.saved()).toEqual(saved);
    await page.screenshot({path: 'test-results/tablet-block-restore.png', fullPage: true});
  } finally { await context.close(); }
});

test('pointer: cancellation discards placement and a fresh tap works', async ({browser, browserName}) => {
  test.skip(browserName !== 'chromium', 'Trusted cancellation uses Chromium CDP.');
  const context = await browser.newContext({baseURL: 'http://127.0.0.1:4173', viewport: {width: 1024, height: 900}, hasTouch: true});
  try {
    const page = await context.newPage(); await readyBuild(page);
    const palette = (await page.getByRole('button', {name: paletteName}).boundingBox())!;
    const board = (await page.getByLabel('쌓기나무 3D 작업판').boundingBox())!;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: palette.x + 20, y: palette.y + 20}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: board.x + board.width / 2, y: board.y + board.height / 2}]});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
    await expect(page.getByText('블록 수: 0', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: '터치로 놓기', exact: true}).tap();
    await page.touchscreen.tap(board.x + board.width / 2, board.y + board.height / 2);
    await expect(page.getByText('블록 수: 1', {exact: true})).toBeVisible();
  } finally { await context.close(); }
});

test('permissions: observation and already completed build problems remain uneditable', async ({page}) => {
  const state = await connect(page);
  await page.goto('/lesson/1/solve');
  await expect(page.getByText('필수 개수 문제', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: paletteName})).toHaveCount(0);
  await page.route('**/functions/v1/student-api', async (route) => {
    const b = route.request().postDataJSON();
    if (b.action !== 'problem') return route.fallback();
    await route.fulfill({json: {problem: problems[2], attempt: {wrongCount: 0, hintShown: false, answerRevealed: false, completed: true}, hint: null}});
  });
  await page.goto('/lesson/1/practice');
  await expect(page.getByText('이 문제는 이미 완료했습니다.', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: paletteName})).toHaveCount(0);
  await expect(page.getByRole('button', {name: '전체 초기화', exact: true})).toBeDisabled();
  await expect(page.getByRole('button', {name: '저장', exact: true})).toBeDisabled();
  await expect(page.getByRole('button', {name: '정답 확인', exact: true})).toBeDisabled();
  expect(state.mutations).toEqual([]);
});

test('pointer engine: drag and cancel lifecycle works without native mouse events', async ({page}) => {
  await readyBuild(page);
  const palette = page.getByRole('button', {name: paletteName}), canvas = page.getByLabel('쌓기나무 3D 작업판');
  const p = (await palette.boundingBox())!, c = (await canvas.boundingBox())!;
  // Explicit synthetic PointerEvents exercise WebKit's handler path; not a claim about an iPad digitizer.
  const start = {bubbles: true, pointerId: 71, pointerType: 'touch', button: 0, isPrimary: true, clientX: p.x+25, clientY: p.y+25};
  const end = {...start, clientX: c.x+c.width/2, clientY: c.y+c.height/2};
  await palette.dispatchEvent('pointerdown', start);
  await canvas.dispatchEvent('pointermove', end);
  await canvas.dispatchEvent('pointercancel', end);
  await expect(page.getByText('블록 수: 0', {exact: true})).toBeVisible();
  await palette.dispatchEvent('pointerdown', {...start, pointerId: 72});
  await canvas.dispatchEvent('pointermove', {...end, pointerId: 72});
  await canvas.dispatchEvent('pointerup', {...end, pointerId: 72});
  await expect(page.getByText('블록 수: 1', {exact: true})).toBeVisible();
});
