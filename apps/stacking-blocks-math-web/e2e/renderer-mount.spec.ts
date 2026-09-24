import {type Page} from "@playwright/test";
import {test,expect} from "./live-fixture";
import {applyAttempt, INITIAL_ATTEMPT, type AttemptState} from "../shared/attempts.ts";

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

// practiceGenerator.ts's lesson-4 branch sets given.heightMap to the exact same
// value as answer.heightMap for HEIGHTMAP_FROM_BUILD problems. If the editable
// grid (or the "함께 제시된 정보" evidence card) ever seeded/showed that value,
// the student would start on the finished answer with nothing left to do.
const heightMapWithLeakyGiven = {
  ...heightMapProblem, id: "qa-heightmap-leaky-given",
  given: { allowRotate: true, allowLayerView: true, heightMap: [[3, 0], [0, 0]] },
};

test("HEIGHTMAP_FROM_BUILD never seeds the editable grid or the evidence card from given.heightMap (same leak class as the PROJECTION_DRAW fix)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("sb.student.token", "qa-token"));
  await page.route("**/functions/v1/student-api", async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const payload = body.action === "lessonProblems"
      ? { problems: [heightMapWithLeakyGiven], requiredComplete: false }
      : body.action === "snapshot:get"
        ? { snapshot: null }
        : { problem: heightMapWithLeakyGiven, attempt: { wrongCount: 0, hintShown: false, answerRevealed: false, completed: false }, hint: null, revealedAnswer: null };
    await route.fulfill({ json: payload });
  });
  await page.goto("/lesson/7/solve");
  const renderer = page.locator('[data-answer-renderer="HeightMapInputRenderer"]');
  await expect(renderer).toBeVisible();
  // Every editable cell must start at 0, never pre-filled from given.heightMap's [3,0,0,0].
  for (const value of await renderer.locator(".number-cell-value").allInnerTexts()) expect(value).toBe("0");
  // The evidence panel must not exist at all for this problem (its only content would be the leak).
  await expect(page.locator('[aria-label="문제에서 제시한 정보"]')).toHaveCount(0);
});

test("number-map cells (.number-cell) render as true squares -- computed width equals height, not just the <td>'s CSS (a table row can still grow taller than a cell's own height/aspect-ratio when its 3-stacked content wants more room)", async ({ page }) => {
  await openProblem(page, heightMapProblem);
  const cells = page.locator(".number-cell");
  const count = await cells.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = await cells.nth(i).boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs((box as { width: number }).width - (box as { height: number }).height)).toBeLessThanOrEqual(1);
  }
});

// Regression (live Render TEST /lesson/6/solve): BUILD_FROM_VIEWS ("세 방향
// 보고 쌓기") gives the student top/front/side as conditions to build from --
// direction identity there is required information, not the answer, so the
// evidence card must name each face, not show three identical "제시된 조건".
const threeViewBuildProblem = {
  ...tripleProblem, id: "qa-build-from-views", lesson: 6, problemType: "BUILD_FROM_VIEWS", title: "세 방향을 보고 똑같이 쌓기",
  prompt: "위, 앞, 옆에서 본 모양이 아래와 같습니다.\n조건에 맞게 쌓기나무를 쌓아 보세요.",
  given: { projections: { top: [[true, false], [false, true]], front: [[true, false], [false, true]], side: [[true, true], [false, false]] }, allowRotate: true },
  presentation: { visibleRepresentations: ["MODEL_3D"], cameraPolicy: { mode: "FREE" }, answerInput: "BLOCK_BUILD", gridSpecs: {}, instructions: [] },
};

test("BUILD_FROM_VIEWS (lesson 6 'three views build') names each given face -- 위에서 본 모양/앞에서 본 모양/옆에서 본 모양, not a neutralized 제시된 조건, so the student can tell the three grids apart", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("sb.student.token", "qa-token"));
  await page.route("**/functions/v1/student-api", async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const payload = body.action === "lessonProblems"
      ? { problems: [threeViewBuildProblem], requiredComplete: false }
      : body.action === "snapshot:get"
        ? { snapshot: null }
        : { problem: threeViewBuildProblem, attempt: { wrongCount: 0, hintShown: false, answerRevealed: false, completed: false }, hint: null, revealedAnswer: null };
    await route.fulfill({ json: payload });
  });
  await page.goto("/lesson/6/solve");
  const evidence = page.locator('[aria-label="문제에서 제시한 정보"]');
  await expect(evidence).toBeVisible();
  await expect(evidence.locator('table[aria-label="위에서 본 모양"]')).toBeVisible();
  await expect(evidence.locator('table[aria-label="앞에서 본 모양"]')).toBeVisible();
  await expect(evidence.locator('table[aria-label="옆에서 본 모양"]')).toBeVisible();
  await expect(evidence.getByText("제시된 조건")).toHaveCount(0);
});

test("CAMERA_DIRECTION (lesson 2) still neutralizes its evidence caption -- the earlier BUILD_FROM_VIEWS fix must not resurrect the direction-answer leak", async ({ page }) => {
  const cameraDirectionProblem = {
    ...tripleProblem, id: "qa-camera-direction", lesson: 2, problemType: "CAMERA_DIRECTION", title: "이 사진은 어디에서 찍었을까",
    prompt: "아래 격자는 이 모양을 어느 방향에서 본 모습입니다.\n어느 방향에서 본 것인지 고르세요.",
    given: { projections: { front: [[true, false], [false, true]] }, shownFrom: "front", allowRotate: true },
    presentation: { visibleRepresentations: ["MODEL_3D"], cameraPolicy: { mode: "FREE" }, answerInput: "MULTIPLE_CHOICE", gridSpecs: {}, instructions: [] },
  };
  await page.addInitScript(() => localStorage.setItem("sb.student.token", "qa-token"));
  await page.route("**/functions/v1/student-api", async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const payload = body.action === "lessonProblems"
      ? { problems: [cameraDirectionProblem], requiredComplete: false }
      : body.action === "snapshot:get"
        ? { snapshot: null }
        : { problem: cameraDirectionProblem, attempt: { wrongCount: 0, hintShown: false, answerRevealed: false, completed: false }, hint: null, revealedAnswer: null };
    await route.fulfill({ json: payload });
  });
  await page.goto("/lesson/2/solve");
  const evidence = page.locator('[aria-label="문제에서 제시한 정보"]');
  await expect(evidence).toBeVisible();
  await expect(evidence.locator('table[aria-label="제시된 조건"]')).toBeVisible();
  await expect(evidence.getByText("앞에서 본 모양")).toHaveCount(0);
});

// Live bug: "학생이 5번 이상 틀려도 정답이 나오지 않는 경우가 있다." This
// clicks through the real UI against a stateful mock whose server-side logic
// is the actual shared applyAttempt (so the mock is authoritative, not a
// guess), driving 1st/2nd/3rd/4th/5th wrong submissions plus a
// [다시 풀어 보기] cycle, and asserts what the student actually sees on
// screen at every step.
const threeTryChoiceProblem = {
  ...tripleProblem, id: "qa-three-try", lesson: 1, orderIndex: 2, stage: "check", problemType: "CHOICE", title: "정답을 골라 보세요",
  prompt: "다음 중 정답을 고르세요.", given: { allowRotate: true },
  choices: ["오답", "정답"],
  presentation: { visibleRepresentations: [], cameraPolicy: { mode: "FREE" }, answerInput: "MULTIPLE_CHOICE", gridSpecs: {}, instructions: [] },
};

test("3-try support: 1st wrong=재시도만, 2nd wrong=힌트만, 3rd wrong=정답 공개, [다시 풀어 보기]=입력만 초기화(오답 수 유지), 4th/5th wrong=정답 즉시 재공개", async ({ page }) => {
  let state: AttemptState = INITIAL_ATTEMPT;
  await page.addInitScript(() => localStorage.setItem("sb.student.token", "qa-token"));
  await page.route("**/functions/v1/student-api", async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.action === "lessonProblems") return route.fulfill({ json: { problems: [threeTryChoiceProblem], requiredComplete: false } });
    if (body.action === "snapshot:get") return route.fulfill({ json: { snapshot: null } });
    if (body.action === "attempt") {
      const submission = (body as { submission: { kind: string; index: number } }).submission;
      const correct = submission.kind === "choice" && submission.index === 1;
      const outcome = applyAttempt(state, correct, false); // CHOICE is not a build type
      state = outcome.state;
      return route.fulfill({
        json: {
          grade: {
            correct, wrongCount: state.wrongCount, message: outcome.message,
            hint: outcome.sendHint ? "정답은 두 번째 보기예요." : null,
            revealedAnswer: outcome.sendAnswer ? { choiceIndex: 1, explanation: "두 번째가 정답이었어요." } : null,
            needsRebuild: outcome.needsRebuild, completed: state.completed, xpEarned: outcome.xpEarned, stars: outcome.stars, detail: null,
          },
        },
      });
    }
    return route.fulfill({ json: { problem: threeTryChoiceProblem, attempt: { wrongCount: 0, hintShown: false, answerRevealed: false, completed: false }, hint: null, revealedAnswer: null } });
  });

  await page.goto("/lesson/1/solve");
  const wrongChoice = page.getByRole("button", { name: "1. 오답", exact: true });
  const submit = page.getByRole("button", { name: "정답 확인", exact: true });
  const revealPanel = page.locator(".panel .panel");

  // 1st wrong: retry only.
  await wrongChoice.click();
  await submit.click();
  await expect(page.getByText("다시 한 번 풀어 보세요.")).toBeVisible();
  await expect(page.getByText("힌트:")).toHaveCount(0);
  await expect(revealPanel).toHaveCount(0);

  // 2nd wrong: hint, still no answer.
  await wrongChoice.click();
  await submit.click();
  await expect(page.getByText("힌트: 정답은 두 번째 보기예요.")).toBeVisible();
  await expect(revealPanel).toHaveCount(0);

  // 3rd wrong: answer revealed.
  await wrongChoice.click();
  await submit.click();
  await expect(revealPanel).toBeVisible();
  await expect(revealPanel.getByText("정답: 정답")).toBeVisible();

  // [다시 풀어 보기]: hides the panel, resets the choice selection, wrongCount stays (server-side state unaffected -- no request sent).
  await page.getByRole("button", { name: "다시 풀어 보기", exact: true }).click();
  await expect(revealPanel).toHaveCount(0);
  await expect(wrongChoice).not.toHaveClass(/btn-primary/);

  // 4th wrong: answer reappears immediately (no extra hint/retry step needed).
  await wrongChoice.click();
  await submit.click();
  await expect(revealPanel).toBeVisible();
  await expect(revealPanel.getByText("정답: 정답")).toBeVisible();

  await page.getByRole("button", { name: "다시 풀어 보기", exact: true }).click();
  await expect(revealPanel).toHaveCount(0);

  // 5th wrong: still reappears.
  await wrongChoice.click();
  await submit.click();
  await expect(revealPanel).toBeVisible();
  await expect(revealPanel.getByText("정답: 정답")).toBeVisible();

  // Directly submitting the correct answer completes the problem.
  await page.getByRole("button", { name: "다시 풀어 보기", exact: true }).click();
  await page.getByRole("button", { name: "2. 정답", exact: true }).click();
  await submit.click();
  await expect(page.getByText(/완료 \+ XP/)).toBeVisible();
});
