/**
 * Automated checks for specific quality issues already found during the
 * pre-Codex audit. These do not judge new problems' mathematical correctness
 * (that's oracle-cross-check.ts) — they watch for known, concrete defects so
 * a future change can't silently reintroduce or hide them. No problem
 * content is modified here.
 *
 * Run: npm run oracle:known-issues
 */
import { SEED_PROBLEMS, type SeedProblem } from "../shared/seedProblems.ts";
import { generatePracticeProblems, type GeneratedProblem } from "../shared/practiceGenerator.ts";
import { oracleDedupe } from "../oracle/geometry.ts";
import { writeFileSync, mkdirSync } from "node:fs";

type Problem = SeedProblem | GeneratedProblem;
const findings: { title: string; detail: string; evidence: unknown }[] = [];

// --- 1. Duplicate / near-duplicate fixed problems (structural signature, ignores code/title/prompt/lesson) ---

function sortedBlocks(blocks: SeedProblem["givenBlocks"]) {
  return oracleDedupe(blocks).sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
}

function structuralSignature(problem: SeedProblem): string {
  return JSON.stringify({
    type: problem.problemType,
    mode: problem.gradingMode,
    grid: problem.grid,
    given: sortedBlocks(problem.givenBlocks),
    start: sortedBlocks(problem.startBlocks),
    answer: problem.answer,
    givenMeta: problem.given,
    choices: [...problem.choices].sort(),
  });
}

const bySignature = new Map<string, SeedProblem[]>();
for (const problem of SEED_PROBLEMS) {
  const sig = structuralSignature(problem);
  const bucket = bySignature.get(sig) ?? [];
  bucket.push(problem);
  bySignature.set(sig, bucket);
}
const duplicateClusters = [...bySignature.values()].filter((bucket) => bucket.length > 1);
for (const cluster of duplicateClusters) {
  findings.push({
    title: "고정 문제 중복/사실상 동일 (구조적 서명 일치)",
    detail: `${cluster.map((p) => `${p.code}(L${p.lesson})`).join(", ")} — 도형·given·answer·gradingMode가 완전히 동일하고 제목/프롬프트만 다릅니다.`,
    evidence: cluster.map((p) => ({ code: p.code, lesson: p.lesson, title: p.title })),
  });
}

// --- 2. Lesson 6 "minimum"/"maximum" templates never produce minimum/maximum content ---

const lesson6TemplateSamples = new Map<string, string[]>();
for (let seed = 0; seed < 40; seed++) {
  const generated = generatePracticeProblems(6, 6, seed, 1);
  for (const p of generated) {
    const list = lesson6TemplateSamples.get(p.templateId) ?? [];
    if (list.length < 20) list.push(p.prompt);
    lesson6TemplateSamples.set(p.templateId, list);
  }
}
for (const templateId of ["lesson6-minimum", "lesson6-maximum"]) {
  const prompts = lesson6TemplateSamples.get(templateId) ?? [];
  const mentionsMinMax = prompts.filter((p) => /최소|최대/.test(p));
  if (prompts.length > 0 && mentionsMinMax.length === 0) {
    findings.push({
      title: `템플릿 "${templateId}"가 실제로는 최소/최대 문제를 생성하지 않음`,
      detail: `템플릿 카탈로그(shared/practiceGenerator.ts TEMPLATES[6])에는 존재하지만, ${prompts.length}개 표본 프롬프트 중 "최소"/"최대" 단어가 하나도 없습니다. 실제 프롬프트는 4종 범용 문구를 순환할 뿐입니다.`,
      evidence: [...new Set(prompts)],
    });
  }
}

// --- 3. CHOICE answer-position bias ---

const GENERATOR_LESSONS = [1, 2, 3, 4, 5, 6, 7, 8, 12];
const choiceIndexCounts = new Map<number, number>();
let choiceProblemCount = 0;

function tallyChoice(problem: Problem) {
  if (problem.problemType !== "CHOICE" && problem.problemType !== "BLOCK_POSITION") return;
  if (problem.answer.kind !== "choice") return;
  choiceProblemCount++;
  choiceIndexCounts.set(problem.answer.index, (choiceIndexCounts.get(problem.answer.index) ?? 0) + 1);
}

for (const problem of SEED_PROBLEMS) tallyChoice(problem);
for (const lesson of GENERATOR_LESSONS) {
  for (let seed = 0; seed < 60; seed++) {
    for (const problem of generatePracticeProblems(lesson, 6, seed, 1)) tallyChoice(problem);
  }
}

const distribution = [...choiceIndexCounts.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([index, count]) => ({ index, count, share: choiceProblemCount ? count / choiceProblemCount : 0 }));
const dominant = distribution.reduce((max, cur) => (cur.share > max.share ? cur : max), { index: -1, count: 0, share: 0 });
if (choiceProblemCount > 0 && dominant.share >= 0.5) {
  findings.push({
    title: "CHOICE/BLOCK_POSITION 정답 위치 편중",
    detail: `선택형 문제 ${choiceProblemCount}개 중 index=${dominant.index}가 정답인 비율이 ${(dominant.share * 100).toFixed(1)}%입니다. 절반 이상이 같은 위치에 몰려 있어 찍기 전략에 취약합니다.`,
    evidence: distribution,
  });
} else {
  findings.push({
    title: "CHOICE/BLOCK_POSITION 정답 위치 분포 (참고용, 임계치 미만)",
    detail: `선택형 문제 ${choiceProblemCount}개의 정답 위치 분포입니다. 특정 위치가 50% 이상을 차지하지는 않지만, 균등(각 위치 1/n)과는 차이가 있는지 사람이 확인하세요.`,
    evidence: distribution,
  });
}

// --- Report ---

mkdirSync("oracle/reports", { recursive: true });
writeFileSync("oracle/reports/known-issues-report.json", JSON.stringify({ generatedAt: new Date().toISOString(), findings }, null, 2));

const lines: string[] = ["# Independent Oracle — Known Issues Report", "", `생성 시각: ${new Date().toISOString()}`, ""];
for (const f of findings) {
  lines.push(`## ${f.title}`);
  lines.push(f.detail);
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(f.evidence, null, 2));
  lines.push("```");
  lines.push("");
}
writeFileSync("oracle/reports/known-issues-report.md", lines.join("\n"));

console.log(`oracle known-issues: ${findings.length}건 기록 (중복 클러스터 ${duplicateClusters.length}개, CHOICE 표본 ${choiceProblemCount}개)`);
for (const f of findings) console.log(`  - ${f.title}`);
