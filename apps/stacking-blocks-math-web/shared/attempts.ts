/**
 * 오답 처리 규칙 (명세 17, 2026-09 개정) - 이 앱에서 가장 중요한 규칙.
 *
 *   1회 오답 (wrongCount===1)  → "다시 한 번 풀어 보세요." (힌트 X, 정답 X)
 *   2회 오답 (wrongCount===2)  → 힌트 제공                 (정답 X)
 *   3회 이상 오답 (wrongCount>=3) → 정답 공개, 계속 공개 유지
 *
 * 정답 공개 여부는 wrongCount에서 직접 계산한다 ("wrongCount >= 3" 그
 * 자체가 조건이다). 이전 버전은 "힌트를 본 뒤에도 또 틀렸는가"라는 체인
 * (prev.hintShown 확인 후에만 정답 공개)으로 판단했는데, 이 체인이
 * hintShown과 wrongCount 사이에서 조금이라도 어긋나면(예: 어떤 경로로
 * hintShown 없이 wrongCount만 올라간 경우) 정답이 영영 공개되지 않는
 * 구조적 취약점이 있었다 ("5번 이상 틀려도 정답이 안 나오는" 라이브 버그).
 * wrongCount 임계값에서 직접 계산하면 이전 상태가 무엇이었든 상관없이
 * wrongCount>=3인 한 항상 정답을 공개한다.
 *
 * 정답을 본 뒤에도 wrongCount/hintShown/answerRevealed는 절대 초기화하지
 * 않는다(같은 문제를 다시 시도하는 동안 계속 유지). 오직 "새 문제로 이동"
 * 할 때만 초기화된다 (LessonPage.tsx의 applyProblem 참고).
 *
 * "정답 화면을 보여줄지"(answerVisible, UI에서 관리)와 "정답을 볼 자격이
 * 있는지"(answerRevealed, 여기서 관리)는 서로 다른 상태다. 학생이
 * [다시 풀어 보기]를 눌러 정답 화면을 잠깐 숨겨도 answerRevealed/wrongCount
 * 는 그대로이며, 다음 오답 제출에서 이 함수가 다시 sendAnswer:true 를
 * 돌려주면 UI가 즉시 다시 공개한다.
 *
 * 정답을 본 뒤에는 스스로 다시 풀어야 완료된다 (명세 18).
 */

export interface AttemptState {
  /** 지금까지 틀린 횟수. */
  wrongCount: number;
  /** 힌트를 이미 봤는지. */
  hintShown: boolean;
  /** 정답을 이미 공개했는지. */
  answerRevealed: boolean;
  /** 완료 처리되었는지. */
  completed: boolean;
}

export const INITIAL_ATTEMPT: AttemptState = {
  wrongCount: 0,
  hintShown: false,
  answerRevealed: false,
  completed: false,
};

/** 게임 보상 (명세 19). 학업 평가 점수와는 연결하지 않는다. */
export const XP_REWARD = {
  /** 힌트 없이 해결 */
  withoutHint: 30,
  /** 힌트 후 해결 */
  afterHint: 20,
  /** 정답을 본 뒤 다시 완성 */
  afterReveal: 10,
} as const;

export const STAR_REWARD = {
  withoutHint: 3,
  afterHint: 2,
  afterReveal: 1,
} as const;

export type AttemptAction =
  | "none"
  | "retry"
  | "show_hint"
  | "reveal_answer"
  | "rebuild_required"
  | "complete";

export interface AttemptOutcome {
  state: AttemptState;
  action: AttemptAction;
  message: string;
  /** 이번 응답에서 힌트를 함께 내려보내야 하는지. */
  sendHint: boolean;
  /** 이번 응답에서 정답을 함께 내려보내야 하는지. */
  sendAnswer: boolean;
  /** 정답을 보고 다시 쌓아야 완료되는 상태인지. */
  needsRebuild: boolean;
  xpEarned: number;
  stars: number;
}

/**
 * 한 번의 제출 결과를 상태 기계에 통과시킨다.
 * 서버(Edge Function)에서 호출해 그 결과만 학생에게 내려보낸다.
 */
export function applyAttempt(prev: AttemptState, correct: boolean, requiresRebuild = true): AttemptOutcome {
  // 이미 완료한 문제를 다시 풀어도 보상은 중복 지급하지 않는다.
  if (prev.completed) {
    return {
      state: prev,
      action: "none",
      message: correct ? "이미 완료한 문제예요." : "이미 완료한 문제예요.",
      sendHint: false,
      sendAnswer: false,
      needsRebuild: false,
      xpEarned: 0,
      stars: 0,
    };
  }

  if (correct) {
    const xpEarned = prev.answerRevealed
      ? XP_REWARD.afterReveal
      : prev.hintShown
        ? XP_REWARD.afterHint
        : XP_REWARD.withoutHint;

    const stars = prev.answerRevealed
      ? STAR_REWARD.afterReveal
      : prev.hintShown
        ? STAR_REWARD.afterHint
        : STAR_REWARD.withoutHint;

    const message = prev.answerRevealed && requiresRebuild
      ? "정답 모양대로 다시 잘 쌓았어요. 완료!"
      : prev.answerRevealed
        ? "정답을 확인한 뒤 다시 해결했어요. 완료!"
      : prev.hintShown
        ? "힌트를 잘 활용했어요. 정답이에요!"
        : prev.wrongCount > 0
          ? "다시 도전해서 해결했어요!"
          : "정답이에요! 한 번에 해냈네요.";

    return {
      state: { ...prev, completed: true },
      action: "complete",
      message,
      sendHint: false,
      sendAnswer: false,
      needsRebuild: false,
      xpEarned,
      stars,
    };
  }

  const wrongCount = prev.wrongCount + 1;

  // wrongCount >= 3: 정답을 공개한다. 이 조건은 wrongCount 값에서 직접
  // 계산하며, prev.hintShown/prev.answerRevealed의 이전 체인 상태와
  // 무관하게 항상 참이면 공개한다 (라이브 버그였던 구조적 취약점 제거).
  if (wrongCount >= 3) {
    const alreadyRevealed = prev.answerRevealed;
    // Build 타입은 "정답을 보고 스스로 다시 쌓아야" 완료되므로(명세 18),
    // 이미 한 번 공개한 뒤에는 힌트 텍스트를 다시 보내지 않고 "다시
    // 쌓아 보세요" 안내로 구분한다. Build가 아닌 타입은 매번 힌트+정답을
    // 함께 보낸다(기존 동작 유지).
    const sendHintNow = requiresRebuild ? !alreadyRevealed : true;
    const message = requiresRebuild
      ? (alreadyRevealed ? "정답 모양을 한 번 더 살펴보고, 똑같이 다시 쌓아 보세요." : "정답 모양을 보여 줄게요. 잘 살펴보고 똑같이 다시 쌓아 보세요.")
      : "정답을 확인하고 다시 풀어 보세요.";
    return {
      state: { ...prev, wrongCount, hintShown: true, answerRevealed: true },
      action: alreadyRevealed && requiresRebuild ? "rebuild_required" : "reveal_answer",
      message,
      sendHint: sendHintNow,
      sendAnswer: true,
      needsRebuild: requiresRebuild,
      xpEarned: 0,
      stars: 0,
    };
  }

  // 2회째 오답 - 힌트를 준다. 정답은 아직 보여 주지 않는다.
  if (wrongCount === 2) {
    return {
      state: { ...prev, wrongCount, hintShown: true },
      action: "show_hint",
      message: "힌트를 보고 다시 풀어 보세요.",
      sendHint: true,
      sendAnswer: false,
      needsRebuild: false,
      xpEarned: 0,
      stars: 0,
    };
  }

  // 1회째 오답 - 안내만 한다.
  return {
    state: { ...prev, wrongCount },
    action: "retry",
    message: "다시 한 번 풀어 보세요.",
    sendHint: false,
    sendAnswer: false,
    needsRebuild: false,
    xpEarned: 0,
    stars: 0,
  };
}
