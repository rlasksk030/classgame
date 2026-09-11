import { test } from "@playwright/test";

const routes = [
  ["student-login", "/"], ["student-world", "/world"], ["lesson-1", "/lesson/1"], ["lesson-2", "/lesson/2"],
  ["lesson-3-grid", "/lesson/3"], ["lesson-4-height-map", "/lesson/4"], ["lesson-5-restricted", "/lesson/5"],
  ["lesson-6-constraint", "/lesson/6"], ["lesson-7-height", "/lesson/7"], ["lesson-8-layer", "/lesson/8"],
  ["lesson-9-step1", "/lesson/9"], ["lesson-10-builder", "/lesson/10/project"], ["lesson-11-brochure", "/lesson/11/project"],
  ["lesson-12-triple-grid", "/lesson/12"], ["student-rewards", "/world/rewards"], ["teacher-dashboard", "/teacher"],
  ["teacher-students", "/teacher#students"], ["teacher-lessons", "/teacher#lessons"], ["teacher-problem-preview", "/teacher/problem-preview"],
  ["setup", "/setup"],
] as const;

test("desktop route screenshots", async ({ page }) => {
  for (const [name, route] of routes) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `qa/screenshots/1366x768-${name}.png`, fullPage: true });
  }
});

test("tablet touch route screenshots", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await context.newPage();
  for (const [name, route] of routes.filter(([item]) => ["student-world", "lesson-3-grid", "lesson-10-builder", "setup"].includes(item))) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `qa/screenshots/1024x768-touch-${name}.png`, fullPage: true });
  }
  await context.close();
});
