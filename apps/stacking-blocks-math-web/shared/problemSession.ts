/** 한 문제 세트 안에서 현재 위치를 안정적으로 계산하는 순수 함수입니다. */
export function problemIndexForId<T extends { id: string }>(problems: T[], currentId?: string | null): number {
  if (!currentId) return 0;
  const index = problems.findIndex(problem => problem.id === currentId);
  return index >= 0 ? index : 0;
}

export function clampProblemIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(0, index), length - 1);
}
