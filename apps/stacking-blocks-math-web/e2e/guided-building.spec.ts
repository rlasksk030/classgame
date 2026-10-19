import type { Page } from '@playwright/test';
import { test, expect, configureLivePage } from './live-fixture';

const paletteName = '쌓기나무 보관함. 블록을 작업판에 놓기';
async function setup(page: Page, lesson: number) {
  await configureLivePage(page);
  const writes: string[] = [];
  await page.addInitScript(() => localStorage.setItem('sb.student.token', 'synthetic-guided-only'));
  await page.route('**/functions/v1/student-api', async route => {
    const body = route.request().postDataJSON();
    if (body.action !== 'lessonProblems' || body.markGuidedComplete !== false) writes.push(body.action);
    await route.fulfill({json: {problems: [], requiredComplete: false, currentStage: 'guided', seedFallback: false}});
  });
  await page.goto(`/lesson/${lesson}/learn`);
  await expect(page.getByLabel('탐구 블록 수')).toHaveText('현재 5개 · 2층');
  return writes;
}
async function place(page: Page, x = 2, z = 2) {
  const details = page.locator('details').filter({hasText: '버튼으로 놓기'});
  if (!await details.getAttribute('open').then(value => value !== null)) await details.locator('summary').click();
  await page.getByLabel('가로', {exact: true}).fill(String(x));
  await page.getByLabel('세로', {exact: true}).fill(String(z));
  await page.getByRole('button', {name: '쌓기', exact: true}).click();
}
async function centre(page: Page) {
  await page.getByRole('button', {name: '위에서 보기', exact: true}).click();
  await page.waitForTimeout(400); // camera tween, not network readiness
  const canvas = page.getByLabel('쌓기나무 3D 작업판');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  // Odd 3x3 grid: centre is inside the (x=1,z=1) cell, not a grid border.
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}
const height = (page: Page, row: number, col: number) => page.getByRole('button', {name: `높이 지도 ${row}행 ${col}열 증가`, exact: true}).locator('..').locator('.number-cell-value');

for (const lesson of [7, 8]) {
  test(`L${lesson} direct construction, two layers, map synchronisation, undo and local-only state`, async ({page}) => {
    const writes = await setup(page, lesson);
    await expect(page.getByRole('button', {name: paletteName})).toBeVisible();
    await place(page); await place(page);
    await expect(page.getByLabel('탐구 블록 수')).toHaveText('현재 7개 · 2층');
    if (lesson === 7) {
      await expect(height(page, 2, 2)).toHaveText('2');
      await page.getByRole('button', {name: '높이 지도 2행 2열 증가', exact: true}).click();
      await expect(page.getByLabel('탐구 블록 수')).toHaveText('현재 8개 · 3층');
    } else {
      await page.getByLabel('편집할 층').selectOption('1');
      await expect(page.getByRole('button', {name: '2층 편집 2행 2열', exact: true})).toHaveAttribute('aria-pressed', 'true');
      await page.getByLabel('편집할 층').selectOption('2');
      await page.getByRole('button', {name: '3층 편집 2행 2열', exact: true}).click();
      await expect(page.getByLabel('탐구 블록 수')).toHaveText('현재 8개 · 3층');
    }
    await page.getByRole('button', {name: '되돌리기', exact: true}).click();
    await expect(page.getByLabel('탐구 블록 수')).toHaveText('현재 7개 · 2층');
    // Select and delete the upper centre block: 3D -> maps, then undo both.
    let point = await centre(page); await page.mouse.click(point.x, point.y);
    await expect(page.getByRole('button', {name: '선택 블록 삭제'})).toBeEnabled();
    await page.getByRole('button', {name: '선택 블록 삭제'}).click();
    await expect(page.getByLabel('탐구 블록 수')).toHaveText('현재 6개 · 2층');
    if (lesson === 7) await expect(height(page, 2, 2)).toHaveText('1');
    else {
      await page.getByLabel('편집할 층').selectOption('1');
      await expect(page.getByRole('button', {name: '2층 편집 2행 2열', exact: true})).toHaveAttribute('aria-pressed', 'false');
    }
    await page.getByRole('button', {name: '되돌리기', exact: true}).click();
    await expect(page.getByLabel('탐구 블록 수')).toHaveText('현재 7개 · 2층');
    point = await centre(page); await page.mouse.click(point.x, point.y);
    await page.getByLabel('가로', {exact: true}).fill('3');
    await page.getByLabel('세로', {exact: true}).fill('2');
    await page.getByRole('button', {name: '선택 블록 옮기기'}).click();
    if (lesson === 7) { await expect(height(page, 2, 2)).toHaveText('1'); await expect(height(page, 2, 3)).toHaveText('1'); }
    else {
      await expect(page.getByRole('button', {name: '2층 편집 2행 2열', exact: true})).toHaveAttribute('aria-pressed', 'false');
      await page.getByLabel('편집할 층').selectOption('0');
      await expect(page.getByRole('button', {name: '1층 편집 2행 3열', exact: true})).toHaveAttribute('aria-pressed', 'true');
    }
    await page.getByRole('button', {name: '되돌리기', exact: true}).click();
    if (lesson === 7) { await expect(height(page, 2, 2)).toHaveText('2'); await expect(height(page, 2, 3)).toHaveText('0'); }
    else await expect(page.getByRole('button', {name: '1층 편집 2행 3열', exact: true})).toHaveAttribute('aria-pressed', 'false');
    await page.screenshot({path: `test-results/guided-direct-${lesson}.png`, fullPage: true});
    await page.reload(); // Exploration never changes a stored answer or the supplied start model.
    await expect(page.getByLabel('탐구 블록 수')).toHaveText('현재 5개 · 2층');
    expect(writes).toEqual([]);
  });
}

test('L8 rejects floating layers and removal/move of supports, without consuming undo', async ({page}) => {
  await setup(page, 8);
  await place(page); await place(page);
  await page.getByLabel('편집할 층').selectOption('1');
  await page.getByRole('button', {name: '2층 편집 2행 3열', exact: true}).click();
  await expect(page.getByRole('button', {name: '2층 편집 2행 3열', exact: true})).toHaveAttribute('aria-pressed', 'false');
  await page.getByLabel('편집할 층').selectOption('0');
  await page.getByRole('button', {name: '1층 편집 2행 2열', exact: true}).click();
  await expect(page.getByRole('button', {name: '1층 편집 2행 2열', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('현재 층만 보기').selectOption('1');
  const point = await centre(page); await page.mouse.click(point.x, point.y);
  await page.getByRole('button', {name: '선택 블록 삭제'}).click();
  await expect(page.getByText('위에 쌓기나무가 있어서 먼저 위쪽 블록을 옮겨야 해요.', {exact: true})).toBeVisible();
  await page.getByLabel('가로', {exact: true}).fill('3');
  await page.getByLabel('세로', {exact: true}).fill('2');
  await page.getByRole('button', {name: '선택 블록 옮기기'}).click();
  await expect(page.getByLabel('탐구 블록 수')).toHaveText('현재 7개 · 2층');
  await page.getByRole('button', {name: '되돌리기', exact: true}).click();
  await expect(page.getByLabel('탐구 블록 수')).toHaveText('현재 6개 · 2층');
  await page.getByRole('button', {name: '되돌리기', exact: true}).click();
  await expect(page.getByLabel('탐구 블록 수')).toHaveText('현재 5개 · 2층');
  await expect(page.getByRole('button', {name: '되돌리기', exact: true})).toBeDisabled();
});

for (const lesson of [7, 8]) {
  test(`L${lesson} tablet two-tap, drag, cancellation and button placement`, async ({browser, browserName, baseURL}) => {
    const context = await browser.newContext({baseURL, hasTouch: true, viewport: {width: 1024, height: 900}});
    try {
      const page = await context.newPage(); const writes = await setup(page, lesson);
      const palette = page.getByRole('button', {name: paletteName});
      await palette.tap(); let point = await centre(page);
      await page.touchscreen.tap(point.x, point.y);
      await expect(page.getByLabel('탐구 블록 수')).toHaveText('현재 6개 · 2층');
      await palette.scrollIntoViewIfNeeded();
      const p = (await palette.boundingBox())!;
      const c = (await page.getByLabel('쌓기나무 3D 작업판').boundingBox())!;
      point = {x: c.x + c.width / 2, y: c.y + c.height / 2};
      if (browserName === 'chromium') {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: p.x + 25, y: p.y + 25}]});
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [point]});
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      } else {
        // WebKit handler coverage only; not physical iPad drag verification.
        const start = {bubbles: true, pointerId: 71, pointerType: 'touch', button: 0, isPrimary: true, clientX: p.x+25, clientY: p.y+25};
        await palette.dispatchEvent('pointerdown', start);
        await page.getByLabel('쌓기나무 3D 작업판').dispatchEvent('pointermove', {...start, clientX: point.x, clientY: point.y});
        await page.getByLabel('쌓기나무 3D 작업판').dispatchEvent('pointerup', {...start, clientX: point.x, clientY: point.y});
      }
      await expect(page.getByLabel('탐구 블록 수')).toHaveText('현재 7개 · 2층');
      await place(page, 3, 2);
      await expect(page.getByLabel('탐구 블록 수')).toHaveText('현재 8개 · 2층');
      const start = {bubbles: true, pointerId: 72, pointerType: 'touch', button: 0, isPrimary: true, clientX: p.x+25, clientY: p.y+25};
      await palette.dispatchEvent('pointerdown', start);
      await page.getByLabel('쌓기나무 3D 작업판').dispatchEvent('pointercancel', start);
      await expect(page.getByLabel('탐구 블록 수')).toHaveText('현재 8개 · 2층');
      expect(writes).toEqual([]);
    } finally { await context.close(); }
  });
}

test('L7 direct construction can continue above three floors to the numeric-map limit', async ({page}) => {
  await setup(page, 7);
  for (let level = 1; level <= 9; level++) {
    await place(page);
    await expect(height(page, 2, 2)).toHaveText(String(level));
  }
  await place(page);
  await expect(height(page, 2, 2)).toHaveText('9');
  await expect(page.getByLabel('탐구 블록 수')).toHaveText('현재 14개 · 9층');
});
