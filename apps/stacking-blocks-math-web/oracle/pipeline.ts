/**
 * Problem-bank acceptance pipeline scaffold:
 *
 *   generator -> constraints -> independent oracle -> validation
 *   -> difficulty classification -> accepted problem bank
 *
 * This module does not generate a new large problem bank itself — it is the
 * reusable plumbing a future generator (student-specific variants, new
 * lesson-6 min/max content, expanded lesson-9 seed challenges, ...) should
 * run its candidates through before anything is added to shared/seedProblems.ts.
 * A candidate that fails oracle validation is rejected, never "fixed" here.
 */

import { validateCandidate, type OracleCandidate, type ValidationIssue } from "./validate.ts";

export type PipelineDifficulty = "BASIC" | "PRACTICE" | "APPLICATION" | "CHALLENGE";

export interface PipelineAcceptedEntry {
  candidate: OracleCandidate;
  difficulty: PipelineDifficulty;
}

export interface PipelineRejectedEntry {
  candidate: OracleCandidate;
  issues: ValidationIssue[];
}

export interface PipelineResult {
  accepted: PipelineAcceptedEntry[];
  rejected: PipelineRejectedEntry[];
}

/**
 * Independent difficulty classification based only on the candidate's own
 * geometry (block count relative to grid footprint, whether it is a build or
 * constraint task) — not on whatever difficultyTier a generator may already
 * claim. Meant as a cross-check on generator-assigned tiers, not a
 * replacement for pedagogical judgement.
 */
export function classifyDifficulty(candidate: OracleCandidate): PipelineDifficulty {
  const footprint = candidate.grid.gridWidth * candidate.grid.gridDepth;
  const blockCount = candidate.givenBlocks.length || (candidate.answer.kind === "blocks" ? candidate.answer.blocks.length : 0);
  const isBuildTask = ["FREE_BUILD", "BUILD_FROM_VIEWS", "BUILD_FROM_HEIGHTMAP", "BUILD_FROM_LAYERS"].includes(candidate.problemType);

  if (candidate.gradingMode === "constraint") return "CHALLENGE";
  if (isBuildTask || candidate.problemType === "COUNT_AMBIGUOUS") return "APPLICATION";
  if (blockCount >= footprint) return "PRACTICE";
  return "BASIC";
}

/** Runs every candidate through oracle validation and only keeps the ones that pass. Nothing is auto-repaired. */
export function runPipeline(candidates: OracleCandidate[]): PipelineResult {
  const accepted: PipelineAcceptedEntry[] = [];
  const rejected: PipelineRejectedEntry[] = [];
  for (const candidate of candidates) {
    const result = validateCandidate(candidate);
    if (result.ok) {
      accepted.push({ candidate, difficulty: classifyDifficulty(candidate) });
    } else {
      rejected.push({ candidate, issues: result.issues });
    }
  }
  return { accepted, rejected };
}
