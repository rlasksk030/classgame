/**
 * Structural "can a student who doesn't know the answer actually solve this from what's on
 * screen" checks. Not a math/answer re-verification (the independent oracle already owns that).
 * These catch the BLOCK_POSITION-class bug: prompt text promises something (a color, a
 * described shape, a positional relationship) that the generated data never actually provides.
 */
import type { GeneratedProblem } from "./practiceGenerator.ts";
import type { ProblemGiven, ProblemType } from "./types.ts";

export interface ClarityIssue {
  field: string;
  detail: string;
}

const COLOR_MENTION = /빨간|파란|노란|초록|보라/;
const POSITION_RELATION_MENTION = /오른쪽에 있는|왼쪽에 있는|위에 있는|뒤에 있는|앞에 있는|기준\s*블록/;
/** The exact label shape used by the BLOCK_POSITION generator; reused unrelatedly is a real bug. */
const POSITION_LABEL_CHOICE = /에 있는 블록$/;
const DESCRIPTION_MENTION = /설명에\s*(있는|맞는|알맞은)/;

type AuditableProblem = Pick<GeneratedProblem, "problemType" | "prompt" | "choices" | "given">;

function hasReferenceBlock(given: ProblemGiven | undefined): boolean {
  return Boolean(given?.referenceBlock);
}

/** Per-kind: does this problem type require given/choices data beyond a bare prompt to be solvable? */
function auditByKind(problemType: ProblemType, prompt: string, given: ProblemGiven | undefined, choices: string[]): ClarityIssue[] {
  const issues: ClarityIssue[] = [];
  if (problemType === "CAMERA_DIRECTION") {
    if (!given?.projections && !given?.shownFrom) {
      issues.push({ field: "given.projections", detail: `CAMERA_DIRECTION without projections or shownFrom: "${prompt}"` });
    }
  }
  if (problemType === "PROJECTION_DRAW") {
    // The student draws the projection (it's the answer, not given), so given.projections is
    // legitimately absent. The live renderer (LessonPage.projectionFacesFor) instead falls back
    // to face keywords in the prompt itself when no given/presentation face data exists — match
    // that same fallback contract here rather than requiring given.projections.
    const hasGivenFaces = Boolean(given?.projections && Object.keys(given.projections).length > 0);
    const hasFaceKeyword = /위|앞|옆|모두|세\s*방향/.test(prompt);
    if (!hasGivenFaces && !hasFaceKeyword) {
      issues.push({ field: "prompt", detail: `PROJECTION_DRAW prompt names no face (위/앞/옆) and given.projections is empty, so the live renderer cannot infer which grids to show: "${prompt}"` });
    }
  }
  if (problemType === "LAYER_DRAW" && given?.layers && given.layers.length === 0) {
    issues.push({ field: "given.layers", detail: `LAYER_DRAW declares layers but the array is empty: "${prompt}"` });
  }
  if (problemType === "CHOICE" && choices.length < 2) {
    issues.push({ field: "choices", detail: `CHOICE with fewer than 2 options: "${prompt}"` });
  }
  return issues;
}

/**
 * Structural clarity check only (not a full math re-verification). Flags a prompt whose wording
 * promises information the generated given/choices never actually supply.
 */
export function auditProblemClarity(p: AuditableProblem): ClarityIssue[] {
  const issues: ClarityIssue[] = [];
  const prompt = p.prompt ?? "";
  const choices = Array.isArray(p.choices) ? p.choices : [];

  if (COLOR_MENTION.test(prompt) && !hasReferenceBlock(p.given)) {
    issues.push({ field: "given.referenceBlock", detail: `prompt mentions a color but given.referenceBlock is missing: "${prompt}"` });
  }
  if (POSITION_RELATION_MENTION.test(prompt) && !hasReferenceBlock(p.given)) {
    issues.push({ field: "given.referenceBlock", detail: `prompt describes a positional relationship but given.referenceBlock is missing: "${prompt}"` });
  }
  if (DESCRIPTION_MENTION.test(prompt)) {
    const noBackingData = !p.given?.note && choices.length === 0;
    if (noBackingData) issues.push({ field: "prompt", detail: `prompt references "설명" but no choices/given.note exist to read: "${prompt}"` });
  }
  if (p.problemType === "CHOICE" && choices.length > 0) {
    const allPositionLabels = choices.every((c) => POSITION_LABEL_CHOICE.test(c));
    if (allPositionLabels && !POSITION_RELATION_MENTION.test(prompt)) {
      issues.push({
        field: "choices",
        detail: `choices look like BLOCK_POSITION-style positional labels but the prompt is not about a positional relationship: "${prompt}" choices=${JSON.stringify(choices)}`,
      });
    }
  }

  issues.push(...auditByKind(p.problemType, prompt, p.given, choices));
  return issues;
}
