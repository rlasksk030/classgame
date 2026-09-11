import type { PresentationAnswerInput } from "./problemPresentation.ts";

/** 문제 presentation과 학생 답안 컴포넌트를 연결하는 공통 계약입니다. */
export type AnswerRendererName =
  | "MultipleChoiceRenderer"
  | "NumberAnswerRenderer"
  | "SingleGridRenderer"
  | "TripleProjectionGridRenderer"
  | "HeightMapInputRenderer"
  | "LayerMapInputRenderer"
  | "BlockBuildRenderer";

export function answerRendererFor(input: PresentationAnswerInput): AnswerRendererName | null {
  switch (input) {
    case "MULTIPLE_CHOICE": return "MultipleChoiceRenderer";
    case "NUMBER": return "NumberAnswerRenderer";
    case "GRID": return "SingleGridRenderer";
    case "THREE_GRIDS": return "TripleProjectionGridRenderer";
    case "HEIGHT_MAP": return "HeightMapInputRenderer";
    case "LAYER_MAP": return "LayerMapInputRenderer";
    case "BLOCK_BUILD": return "BlockBuildRenderer";
    default: return null;
  }
}
