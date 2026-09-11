import { test, expect, type Page } from "@playwright/test";

const projection = [[true, false], [true, true]];
const tripleProblem = {
  id: "qa-triple", lesson: 3, orderIndex: 2, problemType: "PROJECTION_DRAW", title: "세 방향 그리기",
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
        : { problem, attempt: { wrongCount: 0, hintShown: false, answerRevealed: false, completed: false }, hint: null, revealedAnswer: null };
    await route.fulfill({ json: payload });
  });
  await page.goto(`/lesson/${problem.lesson}`);
  await expect(page.locator("[data-answer-renderer]")).toHaveAttribute("data-answer-renderer", /Renderer$/);
}

test("projection problem mounts the triple grid renderer in the DOM", async ({ page }) => {
  await openProblem(page, tripleProblem);
  await expect(page.locator('[data-answer-renderer="TripleProjectionGridRenderer"]')).toBeVisible();
  await expect(page.locator(".answer-box table.projection-table")).toHaveCount(3);
});

test("layer problem mounts one input grid per layer", async ({ page }) => {
  await openProblem(page, layerProblem);
  await expect(page.locator('[data-answer-renderer="LayerMapInputRenderer"]')).toBeVisible();
  await expect(page.locator(".answer-box table.projection-table")).toHaveCount(2);
});
