/**
 * Reusable "is this candidate problem mathematically sound" validator, built
 * only on oracle/geometry.ts and oracle/dfs.ts (never shared/blocks.ts or
 * shared/grading.ts). This is the validation stage shared by:
 *   - scripts/oracle-cross-check.ts (checks existing problems against it)
 *   - oracle/pipeline.ts (the generator -> oracle -> validation -> difficulty
 *     -> accepted-bank scaffold for future problem banks)
 *
 * A candidate only needs to structurally resemble a problem (see
 * `OracleCandidate`) — it does not need to come from shared/seedProblems.ts
 * or shared/practiceGenerator.ts, so a future independent generator can use
 * this validator too.
 */

import {
  oracleBlockCount,
  oracleCountTrueCells,
  oracleDirectionView,
  oracleEquivalentDirections,
  oracleGrid2DEqual,
  oracleHeightMap,
  oracleHeightMapEqual,
  oracleIsValidStructure,
  oracleLayers,
  oracleLayersEqual,
  oracleMaxBlocksForFrontSilhouette,
  oracleProject,
  type OracleBlock,
  type OracleDirection,
  type OracleGrid,
  type OracleGrid2D,
  type OracleHeightMap,
} from "./geometry.ts";
import { solveViewConstraint, type ConstraintSolveResult } from "./dfs.ts";

export type OracleAnswer =
  | { kind: "blocks"; blocks: OracleBlock[] }
  | { kind: "count"; value: number }
  | { kind: "direction"; value: OracleDirection }
  | { kind: "choice"; index: number }
  | { kind: "projections"; projections: Partial<{ top: OracleGrid2D; front: OracleGrid2D; side: OracleGrid2D }> }
  | { kind: "heightMap"; heightMap: OracleHeightMap }
  | { kind: "layers"; layers: OracleGrid2D[] };

export interface OracleGiven {
  reasoning?: string;
  projections?: Partial<{ top: OracleGrid2D; front: OracleGrid2D; side: OracleGrid2D }>;
  heightMap?: OracleHeightMap;
  layers?: OracleGrid2D[];
  allowRotate?: boolean;
  countOf?: "total" | "layer" | "pattern";
  countLayer?: number;
  note?: string;
}

export interface OracleCandidate {
  code: string;
  lesson: number;
  problemType: string;
  gradingMode: "exact" | "constraint";
  grid: OracleGrid;
  givenBlocks: OracleBlock[];
  startBlocks: OracleBlock[];
  given: OracleGiven;
  answer: OracleAnswer;
  choices: string[];
  prompt?: string;
  explanation?: string;
}

export interface ValidationIssue {
  field: string;
  detail: string;
  oracleValue: unknown;
  existingValue: unknown;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  dfsResult?: ConstraintSolveResult;
}

/** Geometry-only checks: is every piece of given/answer data consistent with the shape it's derived from. */
function choicesAt(candidate: OracleCandidate) { return candidate.answer.kind === "choice" ? candidate.choices[candidate.answer.index] : undefined; }

export function validateCandidateGeometry(candidate: OracleCandidate): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (field: string, detail: string, oracleValue: unknown, existingValue: unknown) =>
    issues.push({ field, detail, oracleValue, existingValue });

  const { grid, givenBlocks, startBlocks, given, answer } = candidate;

  if (givenBlocks.length > 0 && !oracleIsValidStructure(givenBlocks, grid)) {
    push("givenBlocks", "주어진 모양이 물리적으로 불가능합니다.", true, false);
  }
  if (startBlocks.length > 0 && !oracleIsValidStructure(startBlocks, grid)) {
    push("startBlocks", "시작 블록이 물리적으로 불가능합니다.", true, false);
  }
  if (answer.kind === "blocks" && !oracleIsValidStructure(answer.blocks, grid)) {
    push("answer.blocks", "정답 블록 구조가 물리적으로 불가능합니다.", true, false);
  }

  if (answer.kind === 'blocks') {
    if(candidate.problemType==='BUILD_FROM_VIEWS') {
      const shown=oracleProject(answer.blocks,grid);
      for(const [face,rows] of Object.entries(given.projections??{})) if(!oracleGrid2DEqual(rows,shown[face as keyof typeof shown])) push('constraint example', '예시 정답이 공개 투영과 다릅니다.', rows, shown[face as keyof typeof shown]);
    }
    if (candidate.problemType === 'BUILD_FROM_HEIGHTMAP' && given.heightMap && !oracleHeightMapEqual(oracleHeightMap(answer.blocks,grid),given.heightMap)) push('height reconstruction', '높이 지도와 정답 모형이 다릅니다.', given.heightMap, oracleHeightMap(answer.blocks,grid));
    if (candidate.problemType === 'BUILD_FROM_LAYERS' && given.layers && !oracleLayersEqual(oracleLayers(answer.blocks,grid),given.layers)) push('layer reconstruction', '층별 지도와 정답 모형이 다릅니다.', given.layers, oracleLayers(answer.blocks,grid));
  }
  if (given.reasoning) {
    if (['minimum','maximum','sufficient','multiple','impossible-count'].includes(given.reasoning)) {
      const result = solveViewConstraint(given.projections ?? {}, grid, {solutionCap: Number.MAX_SAFE_INTEGER});
      if (result.capped || !result.exists) push('reasoning completeness', '완전 탐색으로 결론을 확인하지 못했습니다.', 'complete nonempty search', result);
      const expected = given.reasoning === 'minimum' ? result.minCount : result.maxCount;
      if (answer.kind === 'count' && answer.value !== expected) push('reasoning count', '가능한 개수의 극값과 다릅니다.', expected, answer.value);
      if (answer.kind === 'choice' && given.reasoning === 'impossible-count') {
        const labels=candidate.choices.map(v=>Number(v.replace(/개$/, '')));
        if(labels.filter(v=>v<result.minCount!||v>result.maxCount!).length!==1 || !(labels[answer.index]<result.minCount!||labels[answer.index]>result.maxCount!)) push('impossible count', '범위 밖 후보가 유일한 정답이어야 합니다.', result, labels);
      }
      if (answer.kind === 'choice' && given.reasoning !== 'impossible-count') {
        const yes = given.reasoning === 'sufficient' ? result.minCount === result.maxCount : result.solutionCount > 1;
        const expectedText = yes ? '알 수 있어요' : '알 수 없어요';
        const multipleText = yes ? '여러 모양이 가능해요' : '한 모양만 가능해요';
        if (choicesAt(candidate) !== (given.reasoning === 'multiple' ? multipleText : expectedText)) push('reasoning choice', '독립 탐색 결론과 선택지가 다릅니다.', yes, choicesAt(candidate));
      }
    }
    if (given.reasoning === 'candidate-match' && answer.kind === 'choice' && given.heightMap) {
      const model=given.heightMap.flatMap((row,z)=>row.flatMap((h,x)=>Array.from({length:h},(_,y)=>({x,y,z}))));
      const projected=oracleProject(model,grid);
      const valid=Object.entries(given.projections??{}).every(([face,rows])=>oracleGrid2DEqual(rows,projected[face as keyof typeof projected]));
      if(choicesAt(candidate)!==(valid?'조건에 맞아요':'조건에 맞지 않아요')) push('candidate match', '후보 투영 판정과 다릅니다.', valid, choicesAt(candidate));
    }
    if (given.reasoning === 'no-hidden' && answer.kind === 'count') {
      const total = oracleCountTrueCells(given.projections?.front ?? []);
      if(answer.value !== total) push('no hidden count', '공개 앞면 칸 수와 다릅니다.', total, answer.value);
    }
    if (given.reasoning === 'height-sum' && answer.kind === 'count') {
      const total = given.heightMap?.flat().reduce((a,b)=>a+b,0);
      if (answer.value !== total) push('height sum', '높이 합과 다릅니다.', total, answer.value);
    }
    if (given.reasoning === 'layer-sum' && answer.kind === 'count') {
      const total = given.layers?.reduce((sum,g)=>sum+oracleCountTrueCells(g),0);
      if (answer.value !== total) push('layer sum', '층별 합과 다릅니다.', total, answer.value);
    }
  }
  if (givenBlocks.length === 0) {
    // Evidence-only conversion tasks still need independent derived geometry.
    if (given.reasoning !== 'candidate-match' && (given.heightMap || given.layers)) {
      const map=given.heightMap ?? Array.from({length:grid.gridDepth},(_,z)=>Array.from({length:grid.gridWidth},(_,x)=>given.layers?.reduce((n,g)=>n+Number(g[z][x]),0)??0));
      const source=map.flatMap((row,z)=>row.flatMap((h,x)=>Array.from({length:h},(_,y)=>({x,y,z}))));
      if(source.length) return [...issues,...validateCandidateGeometry({...candidate,givenBlocks:source})];
    }
    return issues;
  }

  const projected = oracleProject(givenBlocks, grid);
  if (candidate.problemType !== "CAMERA_DIRECTION") {
    (["top", "front", "side"] as const).forEach((face) => {
      const shown = given.projections?.[face];
      if (shown && !oracleGrid2DEqual(projected[face], shown)) {
        push(`given.projections.${face}`, "제시된 투영이 주어진 도형과 다릅니다.", projected[face], shown);
      }
    });
  }
  if (given.heightMap && !oracleHeightMapEqual(oracleHeightMap(givenBlocks, grid), given.heightMap)) {
    push("given.heightMap", "제시된 숫자 지도가 주어진 도형과 다릅니다.", oracleHeightMap(givenBlocks, grid), given.heightMap);
  }
  if (given.layers && !oracleLayersEqual(oracleLayers(givenBlocks, grid), given.layers)) {
    push("given.layers", "제시된 층별 표현이 주어진 도형과 다릅니다.", oracleLayers(givenBlocks, grid), given.layers);
  }

  if (answer.kind === "projections") {
    (["top", "front", "side"] as const).forEach((face) => {
      const expected = answer.projections[face];
      if (expected && !oracleGrid2DEqual(projected[face], expected)) {
        push(`answer.projections.${face}`, "정답 투영이 주어진 도형과 다릅니다.", projected[face], expected);
      }
    });
  }
  if (answer.kind === "heightMap" && !oracleHeightMapEqual(oracleHeightMap(givenBlocks, grid), answer.heightMap)) {
    push("answer.heightMap", "정답 숫자 지도가 주어진 도형과 다릅니다.", oracleHeightMap(givenBlocks, grid), answer.heightMap);
  }
  if (answer.kind === "layers" && !oracleLayersEqual(oracleLayers(givenBlocks, grid), answer.layers)) {
    push("answer.layers", "정답 층별 표현이 주어진 도형과 다릅니다.", oracleLayers(givenBlocks, grid), answer.layers);
  }

  if (answer.kind === "count" && !given.reasoning) {
    if (given.countOf === "layer" && given.countLayer) {
      const layerCount = oracleCountTrueCells(oracleLayers(givenBlocks, grid)[given.countLayer - 1]);
      if (layerCount !== answer.value) {
        push("answer.value(layer count)", `${given.countLayer}층 개수가 주어진 도형과 다릅니다.`, layerCount, answer.value);
      }
    } else if ((given.countOf === undefined || given.countOf === "total") && candidate.problemType === "COUNT") {
      const assumesNoHiddenBlocks = /가정/.test(given.note ?? "") && given.projections?.front;
      if (assumesNoHiddenBlocks && given.projections?.front) {
        const assumedCount = oracleCountTrueCells(given.projections.front);
        if (assumedCount !== answer.value) {
          push("answer.value(assumed no-hidden-block count)", "가정('숨은 블록 없음')에 따른 앞모습 칸 수와 정답이 다릅니다.", assumedCount, answer.value);
        }
      } else {
        const count = oracleBlockCount(givenBlocks);
        if (count !== answer.value) {
          push("answer.value(total count)", "전체 개수가 주어진 도형과 다릅니다.", count, answer.value);
        }
      }
    }
  }

  if (candidate.problemType === "CAMERA_DIRECTION" && answer.kind === "direction") {
    const direction = answer.value;
    const face: "top" | "front" | "side" = direction === "top" ? "top" : direction === "front" || direction === "back" ? "front" : "side";
    const shown = given.projections?.[face];
    const expected = oracleDirectionView(givenBlocks, grid, direction);
    if (!shown || !oracleGrid2DEqual(shown, expected)) {
      push("given.projections (camera direction)", `${direction} 방향 투영이 도형과 다릅니다.`, expected, shown);
    }
    const matches = oracleEquivalentDirections(givenBlocks, grid, direction);
    if (candidate.gradingMode === "exact" && matches.length !== 1) {
      push("direction ambiguity", `단일 정답 방향이어야 하는데 [${matches.join(", ")}]에서 동일한 모습입니다.`, matches, [direction]);
    }
  }

  if (!given.reasoning && candidate.problemType === "COUNT_AMBIGUOUS" && answer.kind === "count" && given.projections?.front) {
    const maxPossible = oracleMaxBlocksForFrontSilhouette(given.projections.front, grid.gridDepth);
    if (maxPossible !== answer.value) {
      push("answer.value(count_ambiguous max)", "앞모습만으로 가능한 최대 개수 공식과 정답이 다릅니다.", maxPossible, answer.value);
    }
  }

  if (candidate.problemType === "COUNT_AMBIGUOUS" && given.allowRotate === false && !given.projections && !given.heightMap && !given.layers) {
    push(
      "count_ambiguous solvability",
      "회전이 막혀 있고 위/앞/옆·숫자 지도·층별 자료가 전혀 없어 학생이 정답을 정당하게 추론할 방법이 없습니다.",
      "no reference data + rotation disabled",
      { allowRotate: given.allowRotate },
    );
  }

  return issues;
}

/** DFS-backed checks for view-constraint (BUILD_FROM_VIEWS) problems: does a solution exist, and is it unique when it must be. */
export function validateCandidateConstraint(candidate: OracleCandidate): { issues: ValidationIssue[]; dfsResult?: ConstraintSolveResult } {
  const issues: ValidationIssue[] = [];
  if (candidate.problemType !== "BUILD_FROM_VIEWS") return { issues };
  const target = candidate.given.projections;
  if (!target || (!target.top && !target.front && !target.side)) return { issues };

  const dfsResult = solveViewConstraint(target, candidate.grid);
  if (!dfsResult.exists) {
    issues.push({
      field: "constraint existence",
      detail: "제시된 위/앞/옆 조건을 만족하는 입체가 독립 DFS 기준으로 하나도 없습니다.",
      oracleValue: dfsResult,
      existingValue: target,
    });
    return { issues, dfsResult };
  }
  if (candidate.gradingMode === "exact" && dfsResult.uniqueness !== "UNIQUE") {
    issues.push({
      field: "constraint uniqueness",
      detail: "exact 채점인데 같은 조건을 만족하는 다른 입체가 존재합니다(독립 DFS).",
      oracleValue: { solutionCount: dfsResult.solutionCount, capped: dfsResult.capped },
      existingValue: "expected exactly 1 (exact grading mode)",
    });
  }
  if (/다른 모양|여러 모양|모양도 정답|모양이 가능/.test(`${candidate.prompt} ${candidate.explanation}`) && !dfsResult.capped && dfsResult.uniqueness === 'UNIQUE') issues.push({field:'constraint multiplicity claim',detail:'여러 모양이라는 설명과 달리 해가 하나입니다.',oracleValue:'UNIQUE',existingValue:candidate.prompt});
  return { issues, dfsResult };
}

/** Full validation used by the acceptance pipeline: geometry + constraint-solvability. */
export function validateCandidate(candidate: OracleCandidate): ValidationResult {
  const geometryIssues = validateCandidateGeometry(candidate);
  const kinds:Record<string,string>={FREE_BUILD:'blocks',BLOCK_POSITION:'choice',CAMERA_DIRECTION:'direction',PROJECTION_DRAW:'projections',COUNT:'count',COUNT_AMBIGUOUS:'count',BUILD_FROM_VIEWS:'blocks',BUILD_FROM_HEIGHTMAP:'blocks',HEIGHTMAP_FROM_BUILD:'heightMap',BUILD_FROM_LAYERS:'blocks',LAYER_DRAW:'layers',PATTERN_NEXT:'choice',CHOICE:'choice'};
  const viewContract=candidate.problemType==='BUILD_FROM_VIEWS'&&candidate.gradingMode==='constraint'&&candidate.answer.kind==='projections';
  if(kinds[candidate.problemType]!==candidate.answer.kind&&!viewContract)geometryIssues.push({field:'answer input contract',detail:'문제 유형과 답안 종류가 다릅니다.',oracleValue:kinds[candidate.problemType],existingValue:candidate.answer.kind});
  if(candidate.answer.kind === 'choice' && (!candidate.choices[candidate.answer.index] || new Set(candidate.choices).size!==candidate.choices.length)) geometryIssues.push({field:'choice contract',detail:'정답 선택지가 없거나 보기가 중복됩니다.',oracleValue:'unique choices with valid answer',existingValue:candidate.choices});
  const { issues: constraintIssues, dfsResult } = validateCandidateConstraint(candidate);
  const issues = [...geometryIssues, ...constraintIssues];
  return { ok: issues.length === 0, issues, dfsResult };
}
