import { useEffect, lazy, Suspense } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { lessonTitle } from '@shared/lessons.ts';
import { getStudentToken } from '../lib/studentApi';
import GuidedExploration from '../features/activities/GuidedExploration';
import { EXPLORATIONS } from '../features/activities/explorationActivities';
const PeerChallengePage=lazy(()=>import('./PeerChallengePage'));
const ArchitecturePage=lazy(()=>import('./ArchitecturePage'));

export default function LessonLearnPage() {
 const {lesson}=useParams();
 const lessonNumber=Number(lesson);
 const guide=EXPLORATIONS[lessonNumber];
 const navigate=useNavigate();
 useEffect(()=>{if(!getStudentToken())navigate('/',{replace:true});},[navigate]);
 if(!guide)return <main className="screen app-max"><h1>차시를 찾을 수 없어요.</h1><Link to="/world">월드로</Link></main>;
 const project=guide.kind==='architecture'||guide.kind==='presentation';
 return <div className="screen app-max stack lesson-learn-page">
  <div className="toolbar-row" style={{justifyContent:'space-between'}}><div><p className="eyebrow">① 개념 배우기</p><h1>{lessonNumber}차시 · {lessonTitle(lessonNumber)}</h1></div><Link className="btn btn-sm" to="/world">월드로</Link></div>
  <p className="direction-note" role="note">이 단원에서 ‘옆’은 오른쪽에서 본 모양이에요.</p>
  <section className="panel stack" aria-label="개념 배우기 안내"><h2>{guide.title}</h2><p><strong>관찰</strong> · {guide.observe}</p><p><strong>조작</strong> · {guide.manipulate}</p><p><strong>발견</strong> · {guide.discover}</p></section>
  <section className="panel stack" aria-label="안내된 탐구" data-guided-lesson={lessonNumber} data-guided-kind={guide.kind}>
   <h2>안내된 탐구</h2>
   <Suspense fallback={<p role="status">활동을 불러오고 있어요…</p>}>
    {guide.kind==='peer'?<PeerChallengePage/>:project?<ArchitecturePage key={lessonNumber}/>:<GuidedExploration key={lessonNumber} kind={guide.kind}/>}
   </Suspense>
  </section>
  <div className="toolbar-row"><button className="btn btn-primary" onClick={()=>navigate(lessonNumber===9?'/lesson/9':project?`/lesson/${lessonNumber}/project`:`/lesson/${lessonNumber}/solve`)}>{project?'작품 활동 계속하기':'② 문제 풀기 시작'}</button>{!project&&lessonNumber!==9&&<button className="btn" onClick={()=>navigate(`/lesson/${lessonNumber}/practice`)}>③ 선택 연습으로 이동</button>}</div>
 </div>;
}
