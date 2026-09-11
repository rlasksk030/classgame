import { Navigate, Route, Routes } from "react-router-dom";

import Placeholder from "./pages/Placeholder";
import StudentLogin from "./pages/StudentLogin";

/**
 * 화면 구성.
 *   /            학생 로그인 (?class=XXXX)
 *   /world       차시 카드 목록 (명세 20)
 *   /lesson/:n   차시 활동
 *   /teacher     교사 관리자 (명세 6)
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<StudentLogin />} />
      <Route
        path="/world"
        element={
          <Placeholder
            title="공간과 입체 월드"
            note="1~12차시 카드 화면입니다. 아직 만들지 않았습니다. (HANDOVER.md 3-B)"
          />
        }
      />
      <Route
        path="/lesson/:lesson"
        element={
          <Placeholder
            title="차시 활동"
            note="3D 쌓기나무 활동 화면입니다. 아직 만들지 않았습니다. (HANDOVER.md 3-A, 3-C)"
          />
        }
      />
      <Route
        path="/teacher/*"
        element={
          <Placeholder
            title="선생님 관리자"
            note="학생·차시·진도·문제 관리 화면입니다. 아직 만들지 않았습니다. (HANDOVER.md 3-D)"
          />
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
