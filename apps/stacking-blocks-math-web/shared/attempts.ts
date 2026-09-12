/**
 * 오답 처리 규칙 (명세 17) - 이 앱에서 가장 중요한 규칙.
 *
 *   1회 오답            → "다시 살펴보세요."      (힌트 X, 정답 X)
 *   2회 오답            → "조금만 더 생각해 볼까요?" (힌트 X, 정답 X)
 *   3회 오답            → 힌트 제공                (정답 X)
 *   힌트를 본 뒤 또 오답 → 그때 정답 공개
 *
 * 3번 틀렸다고 바로 정답을 보여 주지 않는다.
 * 정답을 본 뒤에는 스스로 다시 쌓아야 완료된다 (명세 18).
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

const WRONG_MESSAGES = [
  "다시 살펴보세요.",
  "조금만 더 생각해 볼까요?",
] as const;

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

  // 정답을 이미 본 상태 - 스스로 다시 쌓을 때까지 기다린다.
  if (prev.answerRevealed && requiresRebuild) {
    return {
      state: { ...prev, wrongCount },
      action: "rebuild_required",
      message: "정답 모양을 한 번 더 살펴보고, 똑같이 다시 쌓아 보세요.",
      sendHint: false,
      sendAnswer: true,
      needsRebuild: true,
      xpEarned: 0,
      stars: 0,
    };
  }

  // 힌트를 본 뒤에도 틀렸다 - 이제 정답을 공개한다.
  if (prev.hintShown) {
    return {
      state: { ...prev, wrongCount, answerRevealed: true },
      action: "reveal_answer",
      message: requiresRebuild ? "정답 모양을 보여 줄게요. 잘 살펴보고 똑같이 다시 쌓아 보세요." : "정답을 보여 줄게요. 풀이 방법을 확인하고 다시 답해 보세요.",
      sendHint: true,
      sendAnswer: true,
      needsRebuild: requiresRebuild,
      xpEarned: 0,
      stars: 0,
    };
  }

  // 3회째 오답 - 힌트를 준다. 정답은 아직 보여 주지 않는다.
  if (wrongCount >= 3) {
    return {
      state: { ...prev, wrongCount, hintShown: true },
      action: "show_hint",
      message: "힌트를 볼까요? 힌트를 보고 다시 해 보세요.",
      sendHint: true,
      sendAnswer: false,
      needsRebuild: false,
      xpEarned: 0,
      stars: 0,
    };
  }

  // 1~2회 오답 - 안내만 한다.
  return {
    state: { ...prev, wrongCount },
    action: "retry",
    message: WRONG_MESSAGES[wrongCount - 1],
    sendHint: false,
    sendAnswer: false,
    needsRebuild: false,
    xpEarned: 0,
    stars: 0,
  };
}
