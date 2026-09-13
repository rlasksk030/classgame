import { test, expect } from '@playwright/test';

test('P45 L9 creator flow shows four cards and exact ten-block gate', async ({ page }) => {
  await page.goto('/student/lesson/9/redesign');
  await expect(page.getByRole('heading', { name: '9차시 · 친구 문제 놀이터' })).toBeVisible();
  await expect(page.getByText('STEP 1 / 4')).toBeVisible();
  await expect(page.getByRole('button', { name: '10개 완성 → 문제 카드 고르기' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '쌓기나무 보관함. 블록을 작업판에 놓기' })).toBeVisible();
});

test('P46 L10 starts with a real 10×10 builder and saves project metadata', async ({ page }) => {
  await page.goto('/student/lesson/10/redesign');
  await expect(page.getByText('새 작품은 10×10 작업판에서 시작해요.')).toBeVisible();
  await expect(page.getByText('현재 판 10×10')).toBeVisible();
  await expect(page.locator('canvas[aria-label="쌓기나무 3D 작업판"]')).toBeVisible();
  await page.getByLabel('건축물 이름').fill('QA 건축물');
  await page.getByLabel('설계 이유').fill('수학 공간을 살펴보기 위해');
  await page.getByRole('button', { name: '설계 저장' }).click();
  await expect(page.getByText('저장했어요.')).toBeVisible();
});

test('P47 L11 reads the same saved project and exposes representations', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sb.phase4.project.v1:local:unconfigured:unknown:anonymous', JSON.stringify({ id:'qa', version:1, name:'QA 건축물', reason:'연습', description:'설명', blocks:[{x:0,y:0,z:0}], layerNotes:['1층','2층','3층'], gridWidth:10, gridDepth:10, maxHeight:12 })));
  await page.goto('/student/lesson/11/redesign');
  await expect(page.getByRole('heading', { name: '11차시 · 건축물 소개서 만들기' })).toBeVisible();
  await expect(page.getByText('QA 건축물')).toBeVisible();
  await expect(page.getByRole('heading', { name: '한 장 소개서 미리보기' })).toBeVisible();
});

test('P48 L12 common review supports count input and self evaluation without practice', async ({ page }) => {
  await page.goto('/student/lesson/12/redesign');
  await expect(page.getByRole('heading', { name: '12차시 · 공간과 입체' })).toBeVisible();
  await expect(page.getByText('공통 문제 1/6')).toBeVisible();
  await page.getByRole('button', { name: '다음 문제' }).click();
  await page.getByRole('button', { name: '다음 문제' }).click();
  await expect(page.locator('input[type="number"]')).toBeVisible();
  await page.locator('input[type="number"]').fill('6');
  await page.getByRole('button', { name: '정답 확인' }).click();
  await page.getByLabel('나에게 주는 칭찬').fill('자료를 꼼꼼히 비교했어요.');
  await page.getByRole('button', { name: '마무리 저장' }).click();
  await expect(page.getByText('자기평가는 점수로 채점하지 않아요.')).toBeVisible();
});
