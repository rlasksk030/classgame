import type { ProjectionConstraints } from '../solvers/projection.ts';
import type { BlockCoord, GridConfig, Grid2D, HeightMap } from '../../types.ts';
export const CURRICULUM_VERSION = 'spatial-v2' as const;
export type Stage = 'learn' | 'solve' | 'practice' | 'remediation' | 'challenge';
export type Face = 'top' | 'front' | 'side';
export type ConceptTag = 'information-sufficiency' | 'hidden-blocks' | 'count-range' | 'additional-information' | 'solution-comparison' | 'constraint-build' | 'height-reconstruction' | 'layer-reconstruction' | 'layer-rule' | 'position-right' | 'position-up' | 'layer-count' | 'total-count' | 'description-to-model' | 'direction-front' | 'direction-back' | 'direction-left' | 'direction-right' | 'observer-position' | 'photo-camera-position' | 'column-height' | 'height-map' | 'layer-map' | 'strategy-comparison' | 'projection-direction' | 'projection-top' | 'projection-front' | 'projection-side' | 'projection-error-analysis' | 'projection-change';
export type Choice = { id: string; label: string };
export type AnswerInput =
 | { kind: 'choice'; choices: Choice[] }
 | { kind: 'boolean-judgment'; yesLabel: string; noLabel: string }
 | { kind: 'number'; min: number; max: number }
 | { kind: 'projection-grid'; faces: Face[] }
 | { kind: 'height-map'; max: number }
 | { kind: 'layer-map'; layers: number }
 | { kind: 'block-builder' }
 | { kind: 'mapping'; entries: string[]; choices: Choice[] };
export type AnswerState =
 | { kind: 'choice'; value: string | null }
 | { kind: 'boolean-judgment'; value: boolean | null }
 | { kind: 'number'; value: number | null }
 | { kind: 'projection-grid'; grids: Partial<Record<Face, Grid2D>> }
 | { kind: 'height-map'; grid: HeightMap }
 | { kind: 'layer-map'; grids: Grid2D[] }
 | { kind: 'block-builder'; blocks: BlockCoord[] }
 | { kind: 'mapping'; values: Record<string, string> };
export type GradingPolicy =
 | { kind: 'exact-choice'; value: string }
 | { kind: 'exact-number'; value: number }
 | { kind: 'exact-grid'; grids: Partial<Record<Face, Grid2D>> }
 | { kind: 'exact-height-map'; grid: HeightMap }
 | { kind: 'exact-layers'; grids: Grid2D[] }
 | { kind: 'exact-block-coordinates'; blocks: BlockCoord[] }
 | { kind: 'projection-constraints'; grids: Partial<Record<Face, Grid2D>>; example: BlockCoord[]; constraints?:ProjectionConstraints }
 | { kind: 'multiple-valid-solutions'; solutions: BlockCoord[][] }
 | { kind: 'exact-mapping'; values: Record<string, string> }
 | { kind: 'determinability'; determinable: boolean; evidence: string }
 | { kind: 'min-count' | 'max-count'; solver: 'projection-search-v1'; constraints: Partial<Record<Face, Grid2D>>; value?: number };
export type Material =
 | { kind: 'partial-height-map'; grid:(number|null)[][]; caption:string }
 | { kind: 'model'; blocks: BlockCoord[]; caption: string; view?: 'front'|'back'|'left'|'right' }
 | { kind: 'projection'; face: Face; grid: Grid2D; caption: string }
 | { kind: 'height-map'; grid: HeightMap; caption: string }
 | { kind: 'layer-map'; grids: Grid2D[]; caption: string };
export type ObservationView = Face | 'home' | 'back' | 'left' | 'right';
export type CameraPolicy = { kind: 'free' | 'fixed'; initialView: ObservationView; allowedViews: ObservationView[] };
export interface Problem {
 additionalMaterials?: Material[];
 solutionEvidence?: { solverVersion: string; classification: 'unique'|'multiple-shapes-same-count'|'multiple-shapes-different-count'; solutionCount:number; counts:number[] };
 id: string; curriculumVersion: typeof CURRICULUM_VERSION; version: 1; seed: number;
 lessonId: number; stage: Stage; conceptTags: ConceptTag[]; prompt: string; learningIntent: string;
 grid: GridConfig; presentedMaterials: Material[]; answerInput: AnswerInput; gradingPolicy: GradingPolicy;
 feedbackPolicy: { first: string; hint: string; focus: Face };
 revealPolicy: { kind: 'compare-answer'; reason: string };
 completionPolicy: { kind: 'correct-or-correct-after-reveal' };
 cameraPolicy: CameraPolicy; allowedViews: CameraPolicy['allowedViews'];
 solutionPolicy: { kind: 'unique' | 'any-valid' };
}
export interface ActivityDefinition {
 activityId: string; lessonId: number; order: number; title: string; shortInstruction: string;
 primaryRepresentation: 'model' | 'model-and-grid' | 'projection-comparison';
 interaction: 'visit-views' | 'paint-top' | 'inspect-columns' | 'match-views' | 'predict-build-compare';
 completionCondition: 'two-views' | 'top-and-cell' | 'front-and-side-cell' | 'matched-and-viewed' | 'predicted-built-compared';
 optionalHelp: string; conceptTags: ConceptTag[];
}
