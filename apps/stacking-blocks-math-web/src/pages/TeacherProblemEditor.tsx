import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BlockWorld from '../components/world/BlockWorld';
import { canonicalize, project, toHeightMap, toLayers, validStructure } from '../../shared/blocks.ts';
import type { BlockCoord, ViewPreset, GridConfig, ProblemAnswer } from '../../shared/types.ts';
import { teacherListClasses, type ClassData } from '../lib/studentApi';
import { getSupabase } from '../lib/supabase';

export default function TeacherProblemEditor() {
  const navigate = useNavigate();
  const [classes, setClasses] = useState<ClassData[]>([]), [classId, setClassId] = useState('');
  const [grid, setGrid] = useState<GridConfig>({gridWidth:4,gridDepth:4,maxHeight:4});
  const [blocks, setBlocks] = useState<BlockCoord[]>([]), [selected, setSelected] = useState<BlockCoord|null>(null);
  const [preset, setPreset] = useState<ViewPreset>('home');
  const [title, setTitle] = useState(''), [prompt, setPrompt] = useState(''), [hint, setHint] = useState('');
  const [lesson, setLesson] = useState(6), [type, setType] = useState('BUILD_FROM_VIEWS');
  const [mode, setMode] = useState<'exact'|'constraint'>('exact');
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState<string|null>(null);
  const [history, setHistory] = useState<BlockCoord[][]>([]), [future, setFuture] = useState<BlockCoord[][]>([]);
  useEffect(() => { void teacherListClasses().then(data => { setClasses(data.classes); setClassId(data.classes[0]?.id ?? ''); }).catch(error => setMessage(error.message)); }, []);
  const change = (next: BlockCoord[]) => { setHistory(prev => [...prev, blocks]); setFuture([]); setBlocks(next); setConfirmed(false); };
  const save = async () => {
    if (!confirmed || !classId || !title.trim() || !prompt.trim() || !validStructure(blocks,grid)) return;
    setBusy(true);setMessage(null);
    try {
      const projections = project(blocks,grid);
      const answer:ProblemAnswer = type==='COUNT' ? {kind:'count',value:blocks.length} : type==='PROJECTION_DRAW' ? {kind:'projections',projections} : type==='HEIGHTMAP_FROM_BUILD' ? {kind:'heightMap',heightMap:toHeightMap(blocks,grid)} : type==='LAYER_DRAW' ? {kind:'layers',layers:toLayers(blocks,grid)} : {kind:'blocks',blocks:canonicalize(blocks)};
      const build = type.startsWith('BUILD_');
      const given = type==='BUILD_FROM_HEIGHTMAP' ? {heightMap:toHeightMap(blocks,grid)} : type==='BUILD_FROM_LAYERS' ? {layers:toLayers(blocks,grid)} : type==='BUILD_FROM_VIEWS' ? {projections} : {};
      const {data:user}=await getSupabase().auth.getUser();
      const {error}=await getSupabase().from('sb_problems').insert({class_id:classId,created_by:user.user?.id,title:title.trim(),prompt:prompt.trim(),lesson,problem_type:type,grading_mode:type==='BUILD_FROM_VIEWS'?mode:'exact',grid_width:grid.gridWidth,grid_depth:grid.gridDepth,max_height:grid.maxHeight,given_blocks:build?[]:canonicalize(blocks),start_blocks:[],given:{...given,allowRotate:true,allowLayerView:true},answer,hint,active:true,source_type:'TEACHER_CREATED'});
      if(error) throw error;
      setMessage('문제은행에 등록했습니다. 학생에게 출제됩니다.');setConfirmed(false);
    } catch {setMessage('등록하지 못했습니다. 학급 권한과 서비스 연결을 확인해 주세요.');} finally {setBusy(false);}
  };
  return <main className="screen app-max stack"><h1>3D 문제 만들기</h1>
    <div className="toolbar-row"><button className="btn" onClick={()=>navigate('/teacher')}>교사 관리로</button>
    <label>학급<select value={classId} onChange={e=>setClassId(e.target.value)}>{classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>차시<select value={lesson} onChange={e=>setLesson(Number(e.target.value))}>{Array.from({length:12},(_,i)=><option key={i} value={i+1}>{i+1}차시</option>)}</select></label></div>
    <div className="world-layout"><section className="stack"><div className="toolbar-row">
      {(['gridWidth','gridDepth','maxHeight'] as const).map((key,i)=><label key={key}>{['가로','세로','최대 높이'][i]}<input type="number" min={1} max={8} value={grid[key]} onChange={e=>{const n=Number(e.target.value);if(!Number.isInteger(n)||n<1||n>8)return;const next={...grid,[key]:n};if(!validStructure(blocks,next)){setMessage('현재 블록이 작업판 밖으로 나가요. 먼저 블록을 옮겨 주세요.');return;}setGrid(next);setConfirmed(false);}} /></label>)}
      <button className="btn" disabled={!history.length} onClick={()=>{setFuture(prev=>[blocks,...prev]);setBlocks(history[history.length-1]);setHistory(history.slice(0,-1));setConfirmed(false);}}>되돌리기</button>
      <button className="btn" disabled={!future.length} onClick={()=>{setHistory(prev=>[...prev,blocks]);setBlocks(future[0]);setFuture(future.slice(1));setConfirmed(false);}}>다시 실행</button>
      <button className="btn" onClick={()=>{if(window.confirm('모두 지울까요?'))change([]);}}>초기화</button>
    </div><BlockWorld grid={grid} blocks={blocks} selected={selected} layerMax={null} preset={preset} onPreset={setPreset} onBlocksChange={change} onSelect={setSelected} onMessage={setMessage} /></section>
    <section className="panel stack"><label>문제 제목<input className="field" value={title} onChange={e=>setTitle(e.target.value)} /></label>
      <label>문제 내용<textarea className="field" value={prompt} onChange={e=>setPrompt(e.target.value)} /></label>
      <label>문제 유형<select className="field" value={type} onChange={e=>{setType(e.target.value);setConfirmed(false);}}>
        <option value="BUILD_FROM_VIEWS">위·앞·옆 보고 쌓기</option><option value="BUILD_FROM_HEIGHTMAP">숫자 지도 보고 쌓기</option><option value="BUILD_FROM_LAYERS">층별 그림 보고 쌓기</option><option value="COUNT">개수 세기</option><option value="PROJECTION_DRAW">위·앞·옆 그리기</option><option value="HEIGHTMAP_FROM_BUILD">숫자 지도 만들기</option><option value="LAYER_DRAW">층별 모양 그리기</option>
      </select></label>
      {type==='BUILD_FROM_VIEWS'&&<label>채점<select value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="exact">현재 모양과 같아야 정답</option><option value="constraint">세 방향 조건을 만족하면 정답</option></select></label>}
      <label>힌트<textarea className="field" value={hint} onChange={e=>setHint(e.target.value)} /></label>
      <p>쌓기나무 {blocks.length}개 · 위/앞/옆, 숫자 지도와 층별 모양을 함께 저장합니다.</p>
      <button className="btn" disabled={!blocks.length} onClick={()=>setConfirmed(true)}>이 모양을 정답으로 확정</button>
      <p>{confirmed?'정답 확인됨':'3D 모양을 확인하고 정답을 확정해 주세요.'}</p>
      <button className="btn btn-primary" disabled={busy||!confirmed||!classId||!title.trim()||!prompt.trim()} onClick={()=>void save()}>문제 추가</button>
      {message&&<p role="status">{message}</p>}
    </section></div>
  </main>;
}
