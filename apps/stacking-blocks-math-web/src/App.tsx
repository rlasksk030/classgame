import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import StudentLogin from './pages/StudentLogin';
const StudentWorld = lazy(() => import('./pages/StudentWorld'));
const LessonPage = lazy(() => import('./pages/LessonPage'));
const TeacherPage = lazy(() => import('./pages/TeacherPage'));
const TeacherGate = lazy(() => import('./pages/TeacherGate'));
const TeacherProblemEditor = lazy(() => import('./pages/TeacherProblemEditor'));
const TeacherStudentRecord = lazy(() => import('./pages/TeacherStudentRecord'));
export default function App() {
  return <Suspense fallback={<main className="screen app-max"><p role="status">화면을 준비하고 있어요…</p></main>}><Routes>
    <Route path="/" element={<StudentLogin />} />
    <Route path="/world" element={<StudentWorld />} />
    <Route path="/lesson/:lesson" element={<LessonPage />} />
    <Route path="/teacher" element={<TeacherGate><TeacherPage /></TeacherGate>} />
    <Route path="/teacher/problems/new" element={<TeacherGate><TeacherProblemEditor /></TeacherGate>} />
    <Route path="/teacher/students/:studentId" element={<TeacherGate><TeacherStudentRecord /></TeacherGate>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense>;
}
