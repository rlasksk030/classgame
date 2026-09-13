import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ActivityBuilder from '../activities/ActivityBuilder';
import Representations from '../activities/Representations';
import MathGrid from '../answers/MathGrid';
import PeerChallengePage from '../../pages/PeerChallengePage';
import { getResolvedSupabaseConfig } from '../../lib/config';
import { getStudentToken } from '../../lib/studentApi';
import { project, toHeightMap, toLayers } from '../../../shared/blocks.ts';
import { reviewProblems, type ReviewItem } from '../../../shared/phase4.ts';
import type { BlockCoord } from '../../../shared/types.ts';

function scopedKey(name: string) {
  const config = getResolvedSupabaseConfig();
  const token = getStudentToken();
  let student = 'anonymous'; let classId = 'unknown';
  try { const payload = token ? JSON.parse(atob(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))) : null; student = typeof payload?.sid === 'string' ? payload.sid : student; classId = typeof payload?.cid === 'string' ? payload.cid : classId; } catch { /* no student session in local preview */ }
  return `${name}:${config?.installationId ?? 'local'}:${config?.supabaseUrl ?? 'unconfigured'}:${classId}:${student}`;
}
type ProjectState = { id: string; version: number; name: string; reason: string; description: string; blocks: BlockCoord[]; layerNotes: string[]; gridWidth: number; gridDepth: number; maxHeight: number; };
const EMPTY_PROJECT: ProjectState = { id: 'local-project', version: 0, name: '', reason: '', description: '', blocks: [], layerNotes: ['', '', ''], gridWidth: 10, gridDepth: 10, maxHeight: 12 };

export default function Phase4Page() {
  const lesson = Number(useParams().lessonId);
  if (lesson === 9) return <PeerChallengePage />;
  if (lesson === 10 || lesson === 11) return <ArchitecturePhase4 lesson={lesson} />;
  if (lesson === 12) return <ReviewPhase4 />;
  return <main className="screen app-max"><p>이 차시는 준비 중이에요.</p><Link className="btn" to="/world">학생 홈</Link></main>;
}

function ArchitecturePhase4({ lesson }: { lesson: number }) {
  const projectKey = scopedKey('sb.phase4.project.v1');
  const [projectState, setProject] = useState<ProjectState>(() => { try { return JSON.parse(localStorage.getItem(projectKey) ?? 'null') ?? EMPTY_PROJECT; } catch { return EMPTY_PROJECT; } });
  const [saved, setSaved] = useState(false); const [editing, setEditing] = useState(lesson === 10);
  useEffect(() => { try { localStorage.setItem(projectKey, JSON.stringify(projectState)); } catch { /* private mode */ } }, [projectKey, projectState]);
  const update = (patch: Partial<ProjectState>) => { setProject(p => ({ ...p, ...patch, version: p.version + 1 })); setSaved(false); };
  const updateBlocks = (blocks: BlockCoord[]) => { const needed = Math.max(3, (blocks.reduce((max, b) => Math.max(max, b.y + 1), 0))); update({ blocks, layerNotes: [...projectState.layerNotes, ...Array.from({ length: Math.max(0, needed - projectState.layerNotes.length) }, () => '')] }); };
  const grid = { gridWidth: projectState.gridWidth, gridDepth: projectState.gridDepth, maxHeight: projectState.maxHeight };
  const reps = useMemo(() => ({ projections: project(projectState.blocks, grid), layers: toLayers(projectState.blocks, grid), heightMap: toHeightMap(projectState.blocks, grid) }), [projectState.blocks, grid.gridWidth, grid.gridDepth, grid.maxHeight]);
  const save = () => { setSaved(true); try { localStorage.setItem(projectKey, JSON.stringify(projectState)); } catch { /* ignore */ } };
  if (lesson === 11 && !projectState.blocks.length && !projectState.name) return <main className="screen app-max stack"><h1>11차시 · 건축물 소개서</h1><p>먼저 10차시에서 건축물을 만들어 저장해 주세요.</p><Link className="btn btn-primary" to="/student/lesson/10/redesign">10차시로 이동</Link></main>;
  return <main className="screen app-max stack phase4-project"><header><div><p className="eyebrow">{lesson}차시 · 공간과 입체</p><h1>{lesson === 10 ? '나만의 건축물 설계' : '건축물 소개서 만들기'}</h1></div><Link className="btn" to="/world">학생 홈</Link></header>
    {lesson === 10 && <p className="direction-note">새 작품은 10×10 작업판에서 시작해요. 높이는 학습을 방해하지 않는 범위에서 자유롭게 쌓을 수 있어요.</p>}
    {lesson === 10 && editing ? <div className="world-layout"><section className="stack"><ActivityBuilder grid={grid} blocks={projectState.blocks} onChange={updateBlocks} /><div className="toolbar-row"><button className="btn" onClick={() => update({ gridWidth: 12, gridDepth: 12 })}>12×12로 넓히기</button><button className="btn btn-primary" onClick={save}>설계 저장</button></div></section><section className="panel stack"><label>건축물 이름<input className="field" value={projectState.name} onChange={e => update({ name: e.target.value })} /></label><label>설계 이유<textarea className="field" value={projectState.reason} onChange={e => update({ reason: e.target.value })} /></label><label>건축물 설명<textarea className="field" value={projectState.description} onChange={e => update({ description: e.target.value })} /></label><h3>층별 공간</h3>{projectState.layerNotes.map((note, i) => <label key={i}>{i + 1}층<input className="field" value={note} onChange={e => update({ layerNotes: projectState.layerNotes.map((v, j) => j === i ? e.target.value : v) })} /></label>)}<p className="muted">현재 판 {grid.gridWidth}×{grid.gridDepth} · 높이 제한 없이 쌓을 수 있어요.</p></section></div> : <section className="panel stack"><div className="toolbar-row"><h2>{projectState.name || '이름을 지어 주세요'}</h2><button className="btn" onClick={() => setEditing(true)}>건축물 수정하기</button></div><ActivityBuilder grid={grid} blocks={projectState.blocks} onChange={() => undefined} disabled /><Representations given={reps} /><button className="btn btn-primary" onClick={save}>소개서 저장</button><p role="status">{saved ? '저장했어요.' : '저장 전 내용을 확인해 주세요.'}</p></section>}
    {lesson === 11 && <section className="panel stack"><h2>한 장 소개서 미리보기</h2><h3>{projectState.name}</h3><p>{projectState.reason}</p><p>{projectState.description}</p><div className="toolbar-row">{reps.projections && <Representations given={reps} />}</div>{projectState.layerNotes.map((note, i) => <p key={i}><strong>{i + 1}층</strong> · {note || '공간 설명 없음'}</p>)}<button className="btn btn-primary" onClick={save}>소개서 저장</button></section>}
  </main>;
}

function ReviewPhase4() {
  const reviewKey = scopedKey('sb.phase4.review');
  const [seed, setSeed] = useState(() => Number(localStorage.getItem(`${reviewKey}:seed`) ?? 1));
  const [index, setIndex] = useState(0); const [answers, setAnswers] = useState<Record<string, unknown>>({}); const [done, setDone] = useState<Record<string, boolean>>({}); const [self, setSelf] = useState('');
  const common = useMemo(() => reviewProblems(seed), [seed]); const all = useMemo(() => [...common, ...reviewProblems(seed + 97).slice(0, 4)], [common, seed]); const item: ReviewItem | undefined = all[index];
  const submit = () => { if (!item) return; const value = answers[item.id]; const correct = item.answerKind === 'count' ? Number(value) === item.expected : item.answerKind === 'direction' ? value === item.expected : (item.answerKind === 'projections' || item.answerKind === 'layers') ? JSON.stringify(value) === JSON.stringify(item.expected) : Boolean(value); setDone(v => ({ ...v, [item.id]: correct })); };
  const currentGrid = item && item.answerKind === 'projections' ? (answers[item.id] as {top?:boolean[][];front?:boolean[][];side?:boolean[][]} | undefined) : undefined;
  const currentLayers = item && item.answerKind === 'layers' ? (answers[item.id] as boolean[][][] | undefined) : undefined;
  const setProjection = (face: 'top'|'front'|'side', r: number, c: number, v: boolean) => { const next = currentGrid ?? { top: (item?.expected as {top:boolean[][]}).top.map(row => row.map(() => false)), front: (item?.expected as {front:boolean[][]}).front.map(row => row.map(() => false)), side: (item?.expected as {side:boolean[][]}).side.map(row => row.map(() => false)) }; setAnswers(a => ({ ...a, [item!.id]: { ...next, [face]: next[face]!.map((row, ri) => row.map((cell, ci) => ri === r && ci === c ? v : cell)) } })); };
  const setLayer = (layer: number, r: number, c: number, v: boolean) => { const expected = item?.expected as boolean[][][]; const next = currentLayers ?? expected.map(g => g.map(row => row.map(() => false))); setAnswers(a => ({ ...a, [item!.id]: next.map((g, i) => i === layer ? g.map((row, ri) => row.map((cell, ci) => ri === r && ci === c ? v : cell)) : g) })); };
  return <main className="screen app-max stack phase4-review"><header><div><p className="eyebrow">12차시 · 공간과 입체</p><h1>단원 돌아보기와 마무리</h1></div><Link className="btn" to="/world">학생 홈</Link></header><nav className="toolbar-row" aria-label="단원 마무리 단계"><span className="btn btn-primary">① 단원 돌아보기</span><span className="btn">② 공통 문제 6 + 맞춤 문제 4</span><span className="btn">③ 보충·더 풀어보기</span></nav><section className="panel stack"><h2>{index < 6 ? `공통 문제 ${index + 1}/6` : `맞춤 문제 ${index - 5}/4`}</h2>{item && <><p>{item.prompt}</p>{item.answerKind === 'count' ? <input className="field" type="number" value={String(answers[item.id] ?? '')} onChange={e => setAnswers(v => ({ ...v, [item.id]: e.target.value }))} /> : item.answerKind === 'direction' ? <div className="spatial-choices">{['front','back','left','right'].map(v => <button className="btn" key={v} aria-pressed={answers[item.id] === v} onClick={() => setAnswers(a => ({ ...a, [item.id]: v }))}>{v === 'right' ? '오른쪽 옆' : v === 'front' ? '앞' : v === 'back' ? '뒤' : '왼쪽'}</button>)}</div> : item.answerKind === 'projections' ? <div className="spatial-grids">{(['top','front','side'] as const).map(face => <MathGrid key={face} face={face} title={face === 'top' ? '위 답안' : face === 'front' ? '앞 답안' : '옆 답안'} rows={currentGrid?.[face] ?? (item.expected as {top:boolean[][];front:boolean[][];side:boolean[][]})[face].map(row => row.map(() => false))} floor={face === 'top'} onChange={(r,c,v) => setProjection(face, r, c, Boolean(v))} />)}</div> : item.answerKind === 'layers' ? <div className="spatial-grids">{(currentLayers ?? (item.expected as boolean[][][]).map(g => g.map(row => row.map(() => false)))).map((grid, i) => <MathGrid key={i} title={`${i + 1}층 답안`} rows={grid} floor onChange={(r,c,v) => setLayer(i, r, c, Boolean(v))} />)}</div> : <p className="muted">자료를 살펴보고 답안을 완성해 보세요.</p>}<button className="btn btn-primary" onClick={submit}>정답 확인</button><p role="status">{done[item.id] ? '정답이에요.' : '천천히 자료를 비교해 보세요.'}</p><button className="btn" disabled={index >= all.length - 1} onClick={() => setIndex(i => i + 1)}>다음 문제</button></>}</section><section className="panel stack"><h2>맞춤·보충 문제</h2><p>필요한 개념을 다시 연습할 수 있어요. 기본 5문제부터 10·15·20문제로 늘릴 수 있어요.</p><div className="toolbar-row">{[5,10,15,20].map(n => <button key={n} className="btn" onClick={() => { localStorage.setItem(`${reviewKey}:practiceCount`, String(n)); }}>{n}문제</button>)}</div><label>나에게 주는 칭찬<textarea className="field" value={self} onChange={e => setSelf(e.target.value)} placeholder="오늘 내가 잘한 점" /></label><p className="muted">자기평가는 점수로 채점하지 않아요.</p><button className="btn btn-primary" onClick={() => { localStorage.setItem(`${reviewKey}:self`, self); localStorage.setItem(`${reviewKey}:seed`, String(seed)); }}>마무리 저장</button><button className="btn" onClick={() => { const next = seed + 1; setSeed(next); setIndex(0); setAnswers({}); setDone({}); localStorage.setItem(`${reviewKey}:seed`, String(next)); }}>새 맞춤 세트 만들기</button></section></main>;
}
