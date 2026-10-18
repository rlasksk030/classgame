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

test('touch: a short palette tap with finger jitter still arms the next board tap', async ({browser}) => {
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

test('pointer: releasing outside without a final move must discard the last valid drop candidate', async ({page}) => {
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
