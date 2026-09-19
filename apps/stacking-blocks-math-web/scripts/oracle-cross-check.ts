/**
 * Independent math oracle cross-check.
 *
 * Compares every fixed problem (SEED_PROBLEMS) and a large procedurally
 * generated sample against oracle/geometry.ts + oracle/dfs.ts, neither of
 * which imports shared/blocks.ts or shared/grading.ts. `shared/grading.ts`
 * itself is imported here deliberately, as the function under test: we feed
 * it oracle-verified inputs and check its verdict, we never use it to
 * compute an "expected" value.
 *
 * Any disagreement is recorded as a mismatch with a concrete counterexample.
 * Nothing here edits problem content or "fixes" a mismatch automatically.
 *
 * Run: npm run oracle:verify
 */
import { SEED_PROBLEMS, type SeedProblem } from "../shared/seedProblems.ts";
import { generatePracticeProblems, getProblemTemplates, type GeneratedProblem } from "../shared/practiceGenerator.ts";
import { grade } from "../shared/grading.ts";
import type { Direction, GridConfig, ProblemAnswer } from "../shared/types.ts";
import { type OracleGrid2D } from "../oracle/geometry.ts";
import { distinctBlockCounts, solveViewConstraint, type ConstraintSolveResult } from "../oracle/dfs.ts";
import { validateCandidateGeometry, validateCandidateConstraint, type OracleCandidate } from "../oracle/validate.ts";
import { writeFileSync, mkdirSync } from "node:fs";

type Problem = SeedProblem | GeneratedProblem;

interface Mismatch {
  code: string;
  lesson: number;
  problemType: string;
  field: string;
  detail: string;
  oracleValue: unknown;
  existingValue: unknown;
}

const mismatches: Mismatch[] = [];
let problemsChecked = 0;
let fixedChecked = 0;
let generatedChecked = 0;
let dfsRuns = 0;
let dfsCapped = 0;
const versions:Record<string,{checked:number;dfs:number;capped:number}>={};
let activeVersion="fixed";

function record(problem: Problem, field: string, detail: string, oracleValue: unknown, existingValue: unknown) {
  mismatches.push({ code: problem.code, lesson: problem.lesson, problemType: problem.problemType, field, detail, oracleValue, existingValue });
}

// Tiers 1 and 3 (geometry consistency + DFS constraint checks) live in
// oracle/validate.ts so the same, already-tested logic backs both this
// cross-check and the oracle/pipeline.ts acceptance pipeline.

function checkGeometry(problem: Problem) {
  for (const issue of validateCandidateGeometry(problem as unknown as OracleCandidate)) {
    record(problem, issue.field, issue.detail, issue.oracleValue, issue.existingValue);
  }
}

function checkConstraint(problem: Problem): ConstraintSolveResult | undefined {
  const { issues, dfsResult } = validateCandidateConstraint(problem as unknown as OracleCandidate);
  for (const issue of issues) record(problem, issue.field, issue.detail, issue.oracleValue, issue.existingValue);
  if (problem.problemType === "BUILD_FROM_VIEWS" && dfsResult) {
    dfsRuns++;
    if (dfsResult.capped) dfsCapped++;
    if (dfsResult.exists) {
      const text = `${problem.prompt} ${problem.explanation}`;
      const claimsMultiple = /다른 모양|여러 모양|모양도 정답|모양이 가능/.test(text);
      if (claimsMultiple && dfsResult.uniqueness === "UNIQUE") {
        record(
          problem,
          "constraint multiplicity claim",
          "문제 설명은 여러 모양이 가능하다고 안내하지만 독립 DFS로는 정답이 하나뿐입니다.",
          dfsResult.uniqueness,
          "multiple solutions expected from problem text",
        );
      }
    }
  }
  return dfsResult;
}

function checkInformationSufficiency(problem: Problem) {
  if (problem.problemType !== "CHOICE" || problem.answer.kind !== "choice") return;
  const front = problem.given.projections?.front;
  if (!front || problem.given.projections?.top || problem.given.projections?.side) return;

  const sufficiencyPattern = /알 수 있|알 수 없|정확히 알 수|정보가 더 필요|충분/;
  if (!sufficiencyPattern.test(problem.choices.join(" "))) return;

  dfsRuns++;
  const result = solveViewConstraint({ front }, problem.grid);
  if (result.capped) dfsCapped++;
  const distinctCounts = distinctBlockCounts(result);
  const ambiguousByOracle = result.uniqueness === "MULTIPLE" && distinctCounts.length > 1;

  const chosenText = problem.choices[problem.answer.index] ?? "";
  const claimsSufficient = /알 수 있|충분/.test(chosenText) && !/없|필요/.test(chosenText);
  const claimsInsufficient = /없|필요/.test(chosenText);

  if (ambiguousByOracle && claimsSufficient) {
    record(
      problem,
      "information sufficiency",
      "독립 DFS로는 같은 앞모습에서도 전체 개수가 달라질 수 있는데(불충분), 정답은 '충분히 알 수 있다' 쪽입니다.",
      { distinctCounts, solutionCount: result.solutionCount },
      chosenText,
    );
  }
  if (!ambiguousByOracle && claimsInsufficient) {
    record(
      problem,
      "information sufficiency",
      "독립 DFS로는 같은 앞모습에서 전체 개수가 항상 같은데(충분), 정답은 '알 수 없다/정보가 더 필요하다' 쪽입니다.",
      { distinctCounts, solutionCount: result.solutionCount },
      chosenText,
    );
  }
}

// --- Tier 2: grader behaviour (grade() is the function under test, not the oracle) ---

function submissionFromAnswer(answer: ProblemAnswer) {
  switch (answer.kind) {
    case "blocks": return { kind: "blocks", blocks: answer.blocks } as const;
    case "count": return { kind: "count", value: answer.value } as const;
    case "direction": return { kind: "direction", value: answer.value } as const;
    case "choice": return { kind: "choice", index: answer.index } as const;
    case "projections": return { kind: "projections", projections: answer.projections } as const;
    case "heightMap": return { kind: "heightMap", heightMap: answer.heightMap } as const;
    case "layers": return { kind: "layers", layers: answer.layers } as const;
  }
}

type Submission = ReturnType<typeof submissionFromAnswer>;

function flipCell(grid: OracleGrid2D): OracleGrid2D {
  const copy = grid.map((row) => [...row]);
  if (copy.length && copy[0].length) copy[0][0] = !copy[0][0];
  return copy;
}

function bumpHeightCell(map: number[][], maxHeight: number): number[][] {
  const copy = map.map((row) => [...row]);
  if (copy.length && copy[0].length) copy[0][0] = copy[0][0] >= maxHeight ? copy[0][0] - 1 : copy[0][0] + 1;
  return copy;
}

function mutateSubmission(submission: Submission, grid: GridConfig): Submission | null {
  switch (submission.kind) {
    case "blocks":
      return submission.blocks.length === 0 ? null : { kind: "blocks", blocks: submission.blocks.slice(1) };
    case "count":
      return { kind: "count", value: submission.value + 1 };
    case "direction": {
      const directions: Direction[] = ["front", "back", "left", "right", "top"];
      const alt = directions.find((d) => d !== submission.value)!;
      return { kind: "direction", value: alt };
    }
    case "choice":
      return { kind: "choice", index: submission.index === 0 ? submission.index + 1 : submission.index - 1 };
    case "projections": {
      const face = (["top", "front", "side"] as const).find((f) => submission.projections[f]);
      if (!face) return null;
      return { kind: "projections", projections: { ...submission.projections, [face]: flipCell(submission.projections[face]!) } };
    }
    case "heightMap":
      return { kind: "heightMap", heightMap: bumpHeightCell(submission.heightMap, grid.maxHeight) };
    case "layers":
      return submission.layers.length === 0
        ? null
        : { kind: "layers", layers: submission.layers.map((layer, index) => (index === 0 ? flipCell(layer) : layer)) };
  }
}

function checkGrader(problem: Problem, dfsResult: ConstraintSolveResult | undefined) {
  if (problem.problemType === "FREE_BUILD") return;
  const { grid, given, answer, gradingMode, problemType } = problem;

  let submission: Submission | undefined = submissionFromAnswer(answer);
  if (gradingMode === "constraint" && problemType === "BUILD_FROM_VIEWS") {
    // The recorded `answer` for constraint problems is not always shaped like
    // a real student submission (some fixed problems store it as
    // "projections" rather than "blocks"). Use an oracle-verified solution
    // instead so this check exercises the grader with a genuinely
    // independent, structurally valid submission.
    const solved = dfsResult?.sampleSolutions[0];
    submission = solved ? { kind: "blocks", blocks: solved } : undefined;
  }
  if (!submission) return;

  const verdict = grade({ problemType, gradingMode, answer, submission, given, grid });
  if (!verdict.correct) {
    record(problem, "grader accepts a verified answer", "오라클로 확인한 정답 구조를 제출해도 채점기가 오답 처리합니다.", true, { verdict, submission });
  }

  if (gradingMode === "exact") {
    const mutated = mutateSubmission(submission, grid);
    if (mutated) {
      const wrongVerdict = grade({ problemType, gradingMode, answer, submission: mutated, given, grid });
      if (wrongVerdict.correct) {
        record(problem, "grader rejects a wrong answer", "정답에서 한 곳을 바꾼 제출도 채점기가 정답 처리합니다.", false, { mutated, wrongVerdict });
      }
    }
  }
}

function checkProblem(problem: Problem) {
  problemsChecked++;
  const stats=versions[activeVersion]??{checked:0,dfs:0,capped:0};versions[activeVersion]=stats;stats.checked++;
  const before=dfsRuns,beforeCapped=dfsCapped;
  checkGeometry(problem);
  const dfsResult = checkConstraint(problem);
  checkInformationSufficiency(problem);
  checkGrader(problem, dfsResult);
  if(['minimum','maximum','sufficient','multiple','impossible-count'].includes(problem.given.reasoning??'')) {
    const result=solveViewConstraint(problem.given.projections??{},problem.grid,{solutionCap:Number.MAX_SAFE_INTEGER});
    dfsRuns++;if(result.capped)dfsCapped++;
  }
  stats.dfs+=dfsRuns-before;stats.capped+=dfsCapped-beforeCapped;
}

// --- Run over every fixed problem ---

for (const problem of SEED_PROBLEMS) {
  checkProblem(problem);
  fixedChecked++;
}

// --- Run over a large procedurally generated sample ---

const GENERATOR_LESSONS = [1, 2, 3, 4, 5, 6, 7, 8, 12];
const SEEDS_PER_LESSON = Number(process.env.ORACLE_SEEDS ?? 60);

for (const lesson of GENERATOR_LESSONS) {
  for (const version of [1, 2, 3] as const) {
    activeVersion=String(version);
    const templateCount = Math.max(getProblemTemplates(lesson,version).length, 1);
    for (let seed = 0; seed < (version===3?Math.max(SEEDS_PER_LESSON,120):SEEDS_PER_LESSON); seed++) {
      const generated = generatePracticeProblems(lesson, templateCount, seed, version);
      for (const problem of generated) {
        checkProblem(problem);
        generatedChecked++;
      }
    }
  }
}

// --- Report ---

mkdirSync("oracle/reports", { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  seedsPerLesson: SEEDS_PER_LESSON,
  seedsPerLessonByVersion: { 1: SEEDS_PER_LESSON, 2: SEEDS_PER_LESSON, 3: Math.max(SEEDS_PER_LESSON, 120) },
  problemsChecked,
  fixedChecked,
  generatedChecked,
  dfsRuns,
  dfsCapped,
  versions,
  mismatchCount: mismatches.length,
  mismatches,
};
writeFileSync("oracle/reports/cross-check-report.json", JSON.stringify(report, null, 2));

const lines: string[] = [];
lines.push("# Independent Math Oracle — Cross-check Report");
lines.push("");
lines.push(`생성 시각: ${report.generatedAt}`);
lines.push(`검증한 문제 수: 고정 ${fixedChecked}개 + 생성 ${generatedChecked}개 (차시당 v1/v2 시드 ${SEEDS_PER_LESSON}개씩, v3 시드 ${Math.max(SEEDS_PER_LESSON,120)}개) = 총 ${problemsChecked}개`);
lines.push(`DFS 제약 검증 실행 횟수: ${dfsRuns} (한도 도달: ${dfsCapped})`);
lines.push(`버전별 검사/DFS/한도: ${JSON.stringify(versions)}`);
lines.push('구버전 한도 도달은 완전 탐색 PASS가 아닙니다. 신규 v3의 극값·유일성은 완전 탐색만 사용합니다.');
lines.push(`불일치: ${mismatches.length}건`);
lines.push("");
if (mismatches.length === 0) {
  lines.push("독립 오라클과 기존 generator/grader 사이에 불일치가 발견되지 않았습니다.");
} else {
  lines.push("## 불일치 목록 (최대 200건 표시, 전체는 cross-check-report.json)");
  lines.push("");
  for (const m of mismatches.slice(0, 200)) {
    lines.push(`### ${m.code} (차시 ${m.lesson}, ${m.problemType}) — ${m.field}`);
    lines.push(`- ${m.detail}`);
    lines.push(`- oracle: \`${JSON.stringify(m.oracleValue)}\``);
    lines.push(`- existing: \`${JSON.stringify(m.existingValue)}\``);
    lines.push("");
  }
}
writeFileSync("oracle/reports/cross-check-report.md", lines.join("\n"));

console.log(`oracle cross-check: ${problemsChecked}개 검사 (고정 ${fixedChecked} + 생성 ${generatedChecked}), DFS ${dfsRuns}회, 불일치 ${mismatches.length}건`);
if (mismatches.length > 0) {
  console.error("불일치가 발견되었습니다. oracle/reports/cross-check-report.md 를 확인하세요.");
  for (const m of mismatches.slice(0, 20)) {
    console.error(`  ✗ ${m.code} [${m.field}] ${m.detail}`);
  }
  process.exit(1);
}
