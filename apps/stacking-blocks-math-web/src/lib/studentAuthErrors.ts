export type StudentAuthErrorCode =
  | "CLASS_NOT_FOUND"
  | "STUDENT_NOT_FOUND"
  | "STUDENT_INACTIVE"
  | "PIN_INVALID"
  | "STUDENT_AUTH_SERVER";

export function studentAuthErrorMessage(error: unknown): string {
  const value = error as { code?: string } | null;
  switch ((value?.code ?? "").toUpperCase()) {
    case "CLASS_NOT_FOUND":
      return "반을 찾지 못했어요. 선생님이 주신 링크를 확인해 주세요.";
    case "STUDENT_NOT_FOUND":
      return "이 학급에서 학생 이름을 찾지 못했어요. 이름을 확인해 주세요.";
    case "STUDENT_INACTIVE":
    case "STUDENT_DISABLED":
      return "지금은 이 학생 계정을 사용할 수 없어요. 선생님께 말씀해 주세요.";
    case "PIN_INVALID":
    case "PIN_MISMATCH":
      return "PIN이 맞지 않아요. 다시 확인해 주세요.";
    case "STUDENT_AUTH_SERVER":
      return "학생 로그인을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
    default:
      return "로그인하지 못했어요. 다시 확인해 주세요.";
  }
}
