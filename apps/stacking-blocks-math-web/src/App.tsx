import { lazy, Suspense, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import StudentLogin from './pages/StudentLogin';
import SetupPage from './pages/SetupPage';
import { getPendingInstallationConfig, hasInvalidInstallationConfigHash, saveRuntimeSupabaseConfig } from './lib/config';
import { clearStudentToken } from './lib/studentApi';
const Phase3Redesign = lazy(() => import('./features/learning/Phase3Redesign'));
const Phase4Page = lazy(() => import('./features/learning/Phase4Page'));
function RedesignRoute(){const id=Number(useParams().lessonId);return id>=5&&id<=8?<Phase3Redesign/>:id>=9&&id<=12?<Phase4Page/>:<Phase2Redesign/>;}
const Phase2Redesign = lazy(() => import('./features/learning/Phase2Redesign'));
const Lesson3Redesign = lazy(() => import('./features/learning/Lesson3Redesign'));
const StudentWorld = lazy(() => import('./pages/StudentWorld'));
const RewardsPage = lazy(() => import('./pages/RewardsPage'));
const LessonPage = lazy(() => import('./pages/LessonPage'));
const LessonLearnPage = lazy(() => import('./pages/LessonLearnPage'));
const TeacherPage = lazy(() => import('./pages/TeacherPage'));
const TeacherGate = lazy(() => import('./pages/TeacherGate'));
const TeacherProblemEditor = lazy(() => import('./pages/TeacherProblemEditor'));
const TeacherProblemPreview = lazy(() => import('./pages/TeacherProblemPreview'));
const TeacherStudentRecord = lazy(() => import('./pages/TeacherStudentRecord'));
const PeerChallengePage = lazy(() => import('./pages/PeerChallengePage'));
const ArchitecturePage = lazy(() => import('./pages/ArchitecturePage'));
function LessonRoute(){const {lesson}=useParams();return lesson==="10"||lesson==="11"?<ArchitecturePage/>:<LessonPage/>;}
function InstallationSwitchPrompt(){
  const location=useLocation();
  const pending=getPendingInstallationConfig();
  const [dismissed,setDismissed]=useState(false);
  if(hasInvalidInstallationConfigHash() && location.pathname!=="/setup") return <Navigate to="/setup?invalid=1" replace />;
  if(!pending || dismissed) return null;
  const switchInstallation=()=>{
    saveRuntimeSupabaseConfig(pending);
    clearStudentToken();
    setDismissed(true);
    window.location.reload();
  };
  return <div role="dialog" aria-label="설치 설정 변경" className="installation-switch"><strong>다른 설치 설정이 있어요.</strong><span>이 기기의 연결을 {pending.installationId} 설치로 변경할까요?</span><div><button className="btn btn-sm btn-primary" onClick={switchInstallation}>변경</button><button className="btn btn-sm" onClick={()=>setDismissed(true)}>유지</button></div></div>;
}
export default function App() {
  return <Suspense fallback={<main className="screen app-max"><p role="status">화면을 준비하고 있어요…</p></main>}><InstallationSwitchPrompt/><Routes>
    <Route path="/student/lesson/:lessonId/redesign" element={<RedesignRoute />} />
    <Route path="/student/lesson/3/redesign" element={<Lesson3Redesign />} />
    <Route path="/setup" element={<SetupPage />} />
    <Route path="/" element={<StudentLogin />} />
    <Route path="/world" element={<StudentWorld />} />
    <Route path="/world/rewards" element={<RewardsPage />} />
    <Route path="/lesson/9" element={<PeerChallengePage />} />
    <Route path="/lesson/:lesson/project" element={<ArchitecturePage />} />
    <Route path="/lesson/:lesson/learn" element={<LessonLearnPage />} />
    <Route path="/lesson/:lesson/solve" element={<LessonPage />} />
    <Route path="/lesson/:lesson/practice" element={<LessonPage />} />
    <Route path="/lesson/:lesson" element={<LessonRoute />} />
    <Route path="/teacher" element={<TeacherGate><TeacherPage /></TeacherGate>} />
    <Route path="/teacher/problems/new" element={<TeacherGate><TeacherProblemEditor /></TeacherGate>} />
    <Route path="/teacher/problem-preview" element={<TeacherGate><TeacherProblemPreview /></TeacherGate>} />
    <Route path="/teacher/students/:studentId" element={<TeacherGate><TeacherStudentRecord /></TeacherGate>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense>;
}
