import {type Page} from "@playwright/test";
import {test,expect} from "./live-fixture";

const projection = [[true, false], [true, true]];
const tripleProblem = {
  stage: "check", id: "qa-triple", lesson: 3, orderIndex: 2, problemType: "PROJECTION_DRAW", title: "세 방향 그리기",
  prompt: "위·앞·옆에서 본 모양을 모두 그려 보세요.", grid: { gridWidth: 2, gridDepth: 2, maxHeight: 2 },
  givenBlocks: [{ x: 0, y: 0, z: 0 }], startBlocks: [], choices: [], difficulty: 1, xp: 10,
  given: { projections: { top: projection, front: projection, side: projection }, allowRotate: true },
  presentation: { visibleRepresentations: ["MODEL_3D", "TOP_VIEW", "FRONT_VIEW", "SIDE_VIEW"], cameraPolicy: { mode: "FREE" }, answerInput: "THREE_GRIDS", gridSpecs: { top: { rows: 2, cols: 2 }, front: { rows: 2, cols: 2 }, side: { rows: 2, cols: 2 } }, instructions: [] },
};

const layerProblem = {
  ...tripleProblem, id: "qa-layer", lesson: 8, problemType: "LAYER_DRAW", title: "층별 모양 그리기",
  prompt: "1층과 2층 모양을 층별 격자에 그려 보세요.",
  given: { layers: [projection, [[true, false], [false, false]]], allowRotate: true },
  presentation: { visibleRepresentations: ["MODEL_3D", "LAYER_MAP"], cameraPolicy: { mode: "FREE" }, answerInput: "LAYER_MAP", gridSpecs: { layerMap: { rows: 2, cols: 2 } }, instructions: [] },
};

async function openProblem(page: Page, problem: typeof tripleProblem) {
  await page.addInitScript(() => localStorage.setItem("sb.student.token", "qa-token"));
  await page.route("**/functions/v1/student-api", async route => {
    const body = route.request().postDataJSON();
    const payload = body.action === "lessonProblems"
      ? { problems: [problem], requiredComplete: false }
      : body.action === "snapshot:get"
        ? { snapshot: null }
        : body.action === "attempt"
          ? { grade: { correct: false, completed: false, wrongCount: 1, hint: null, revealedAnswer: null, message: "다시 살펴보세요.", xpEarned: 0, starsEarned: 0, detail: null } }
          : { problem, attempt: { wrongCount: 0, hintShown: false, answerRevealed: false, completed: false }, hint: null, revealedAnswer: null };
    await route.fulfill({ json: payload });
  });
  await page.goto(`/lesson/${problem.lesson}/solve`);
  await expect(page.locator("[data-answer-renderer]")).toHaveAttribute("data-answer-renderer", /Renderer$/);
}

test("projection problem mounts the triple grid renderer in the DOM", async ({ page }) => {
  await openProblem(page, tripleProblem);
  await expect(page.locator('[data-answer-renderer="TripleProjectionGridRenderer"]')).toBeVisible();
  await expect(page.locator(".answer-box table.projection-table")).toHaveCount(3);
});

test("projection cells change the submitted payload on the real student route", async ({ page }) => {
  let attemptBody: Record<string, unknown> | null = null;
  await page.addInitScript(() => localStorage.setItem("sb.student.token", "qa-token"));
  await page.route("**/functions/v1/student-api", async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.action === "attempt") attemptBody = body;
    const payload = body.action === "lessonProblems"
      ? { problems: [tripleProblem], requiredComplete: false }
      : body.action === "snapshot:get"
        ? { snapshot: null }
          : body.action === "attempt"
            ? { grade: { correct: false, completed: false, wrongCount: 1, hint: null, revealedAnswer: null, message: "다시 살펴보세요.", xpEarned: 0, starsEarned: 0, detail: null } }
            : { problem: tripleProblem, attempt: { wrongCount: 0, hintShown: false, answerRevealed: false, completed: false }, hint: null, revealedAnswer: null };
    await route.fulfill({ json: payload });
  });

  await page.goto("/lesson/3/solve");
  const renderer = page.locator('[data-answer-renderer="TripleProjectionGridRenderer"]');
  await expect(renderer).toBeVisible();
  const firstCell = renderer.locator("button.cell-btn").first();
  await expect(firstCell).toHaveAttribute("aria-pressed", "false");
  await firstCell.click();
  await expect(firstCell).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "정답 확인", exact: true }).click();
  await expect.poll(() => attemptBody).not.toBeNull();
  const submission = attemptBody?.submission as { kind?: string; projections?: Record<string, boolean[][]> } | undefined;
  expect(submission?.kind).toBe("projections");
  expect(submission?.projections?.top?.[1]?.[0]).toBe(true);
  expect(submission?.projections?.front?.[0]?.[0]).toBe(false);
  expect(submission?.projections?.side?.[0]?.[0]).toBe(false);
});

test("a projection problem without evidence cannot submit or increase attempts", async ({ page }) => {
  const malformed = {
    ...tripleProblem,
    id: "qa-malformed-projection",
    prompt: "모양을 표현해 보세요.",
    given: { allowRotate: true },
    presentation: { ...tripleProblem.presentation, gridSpecs: {}, answerInput: "THREE_GRIDS" },
  };
  let attemptCalls = 0;
  await page.addInitScript(() => localStorage.setItem("sb.student.token", "qa-token"));
  await page.route("**/functions/v1/student-api", async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.action === "attempt") attemptCalls += 1;
    const payload = body.action === "lessonProblems"
      ? { problems: [malformed], requiredComplete: false }
      : body.action === "snapshot:get"
        ? { snapshot: null }
          : body.action === "attempt"
            ? { grade: { correct: false, completed: false, wrongCount: 1, hint: null, revealedAnswer: null, message: "다시 살펴보세요.", xpEarned: 0, starsEarned: 0, detail: null } }
            : { problem: malformed, attempt: { wrongCount: 0, hintShown: false, answerRevealed: false, completed: false }, hint: null, revealedAnswer: null };
    await route.fulfill({ json: payload });
  });
  await page.goto("/lesson/3/solve");
  await expect(page.getByRole("alert")).toContainText("문제를 표시하지 못했어요");
  await expect(page.getByRole("button", { name: "정답 확인", exact: true })).toBeDisabled();
  expect(attemptCalls).toBe(0);
});

test("layer problem mounts one input grid per layer", async ({ page }) => {
  await openProblem(page, layerProblem);
  await expect(page.locator('[data-answer-renderer="LayerMapInputRenderer"]')).toBeVisible();
  await expect(page.locator(".answer-box table.projection-table")).toHaveCount(2);
});

const heightMapProblem = {
  ...tripleProblem, id: "qa-heightmap", lesson: 7, problemType: "HEIGHTMAP_FROM_BUILD", title: "숫자 지도 만들기",
  prompt: "각 자리의 높이를 숫자로 나타내 보세요.", grid: { gridWidth: 2, gridDepth: 2, maxHeight: 9 },
  given: { allowRotate: true },
  presentation: { visibleRepresentations: ["MODEL_3D", "HEIGHT_MAP"], cameraPolicy: { mode: "FREE" }, answerInput: "HEIGHT_MAP", gridSpecs: { heightMap: { rows: 2, cols: 2 } }, instructions: [] },
};

test("height map cells support both increase and decrease, and clamp at 0 and 9 (real tap regression, not just +1 wrap)", async ({ page }) => {
  let submitted: unknown = null;
  await page.addInitScript(() => localStorage.setItem("sb.student.token", "qa-token"));
  await page.route("**/functions/v1/student-api", async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.action === "attempt") submitted = (body as { submission?: unknown }).submission;
    const payload = body.action === "lessonProblems"
      ? { problems: [heightMapProblem], requiredComplete: false }
      : body.action === "snapshot:get"
        ? { snapshot: null }
        : body.action === "attempt"
          ? { grade: { correct: false, completed: false, wrongCount: 1, hint: null, revealedAnswer: null, message: "다시 살펴보세요.", xpEarned: 0, starsEarned: 0, detail: null } }
          : { problem: heightMapProblem, attempt: { wrongCount: 0, hintShown: false, answerRevealed: false, completed: false }, hint: null, revealedAnswer: null };
    await route.fulfill({ json: payload });
  });

  await page.goto("/lesson/7/solve");
  const renderer = page.locator('[data-answer-renderer="HeightMapInputRenderer"]');
  await expect(renderer).toBeVisible();
  const firstCell = renderer.locator(".number-cell").first();
  const dec = firstCell.locator(".number-cell-step").first();
  const inc = firstCell.locator(".number-cell-step").last();
  const value = firstCell.locator(".number-cell-value");

  await expect(value).toHaveText("0");
  await expect(dec).toBeDisabled(); // 0 is the floor: decrease must not be tappable below it

  await inc.click(); await expect(value).toHaveText("1");
  await inc.click(); await expect(value).toHaveText("2");
  await expect(dec).toBeEnabled();
  await dec.click(); await expect(value).toHaveText("1"); // overshoot-then-correct: 0 -> 1 -> 2 -> 1

  for (let target = 2; target <= 9; target++) { // 1 -> 9, exactly reaching the ceiling
    await inc.click();
    await expect(value).toHaveText(String(target)); // wait for each commit before the next tap
  }
  await expect(inc).toBeDisabled(); // must clamp at 9, not wrap back to 0

  await dec.click();
  await expect(value).toHaveText("8");

  await page.getByRole("button", { name: "정답 확인", exact: true }).click();
  await expect.poll(() => submitted).toBeTruthy();
  const heightMap = (submitted as { heightMap: number[][] }).heightMap;
  // Only one cell was ever touched (the display grid may reorder rows for the floor view, so
  // don't assume it lands back at [0][0]) — the rest must still be untouched zeros.
  const flat = heightMap.flat();
  expect(flat.filter((v) => v === 8)).toHaveLength(1);
  expect(flat.reduce((sum, v) => sum + v, 0)).toBe(8);
});
