import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ACTIVITY_GRID, ARCHITECTURE_GRID, EMPTY_BUILDING, validBuilding, type Building } from "../../shared/activities.ts";
import { project, toLayers } from "../../shared/blocks.ts";
import { activityApi, getStudentToken } from "../lib/studentApi";
import { draftKey } from "../lib/snapshotDraft";
import ActivityBuilder from "../features/activities/ActivityBuilder";
import Representations from "../features/activities/Representations";

function splitLayerNote(value: string) {
  const [name = "", ...rest] = value.split("\n");
  return { name, description: rest.join("\n") };
}
function joinLayerNote(name: string, description: string) { return `${name}\n${description}`.trimEnd(); }

export default function ArchitecturePage() {
  const { lesson } = useParams();
  const lessonNumber = Number(lesson);
  const isDesignLesson = lessonNumber === 10;
  const [building, setBuilding] = useState<Building>(EMPTY_BUILDING);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [activeFloor, setActiveFloor] = useState(0);
  const [showBuilder, setShowBuilder] = useState(isDesignLesson);
  const current = useRef(building);
  const dirty = useRef(false);
  const saving = useRef(false);
  const revisionRef = useRef(0);
  const key = draftKey(getStudentToken(), "architecture");
  // 새 프로젝트는 8×8을 사용하고, grid 메타데이터가 없는 예전 5×5 저장물만
  // 기존 작업판으로 열어 호환한다.
  const builderGrid = building.grid_width && building.grid_depth && building.max_height
    ? { gridWidth: building.grid_width, gridDepth: building.grid_depth, maxHeight: building.max_height }
    : (building.blocks.some(block => block.x >= 5 || block.z >= 5) ? ARCHITECTURE_GRID : ACTIVITY_GRID);

  useEffect(() => { setShowBuilder(isDesignLesson); }, [isDesignLesson]);
  const edit = (next: Building) => {
    current.current = next; setBuilding(next); dirty.current = true; revisionRef.current += 1; setRevision(revisionRef.current);
    try { if (key) localStorage.setItem(key, JSON.stringify(next)); setMessage("현재 기기에 임시 저장했어요."); } catch { setMessage("기기 저장 공간을 확인하고 저장 버튼을 눌러 주세요."); }
  };
  const save = async (submit = false) => {
    if (submit && isDesignLesson) { setMessage("10차시는 설계를 저장하고 11차시에서 소개서를 완성해요."); return; }
    if (!ready || saving.current || (!dirty.current && !submit)) return;
    const value = { ...current.current, submitted: submit || current.current.submitted };
    if (!validBuilding(value, submit)) { setMessage("이름, 설계 이유, 설명과 3개 층의 공간 이름·설명을 채우고 3층까지 쌓아 주세요."); return; }
    saving.current = true; setBusy(true); const sent = revisionRef.current;
    try {
      const result = await activityApi<{ version: number }>("project:save", { building: value, lesson: lessonNumber });
      const next = { ...current.current, version: result.version, submitted: value.submitted };
      current.current = next; setBuilding(next);
      if (sent === revisionRef.current) { dirty.current = false; if (key) localStorage.removeItem(key); }
      else if (key) localStorage.setItem(key, JSON.stringify(next));
      setMessage(submit ? "건축물 소개서를 완성했어요." : "설계를 저장했어요.");
    } catch { setMessage("저장하지 못했어요. 인터넷이 연결되면 다시 시도해 주세요."); }
    finally { saving.current = false; setBusy(false); }
  };
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    let active = true; setReady(false);
    void activityApi<{ building: Building | null }>("project:get", { lesson: lessonNumber }).then(({ building: server }) => {
      if (!active) return;
      let draft: Building | null = null; try { draft = key ? JSON.parse(localStorage.getItem(key) ?? "null") : null; } catch { /* server remains available */ }
      const next = draft ?? server ?? EMPTY_BUILDING;
      const withGrid = next.grid_width && next.grid_depth && next.max_height ? next : { ...next, grid_width: builderGrid.gridWidth, grid_depth: builderGrid.gridDepth, max_height: builderGrid.maxHeight };
      current.current = withGrid; setBuilding(withGrid); dirty.current = Boolean(draft); setReady(true);
      if (draft && draft.version !== (server?.version ?? 0)) setMessage("기기에 저장된 최신 설계를 불러왔어요. 저장하면 서버에 반영됩니다.");
    }).catch(() => {
      if (!active) return;
      let draft: Building | null = null; try { draft = key ? JSON.parse(localStorage.getItem(key) ?? "null") : null; } catch { /* ignore */ }
      if (draft) { current.current = draft; setBuilding(draft); dirty.current = true; setReady(true); setMessage("인터넷이 연결되지 않아 기기 임시 저장본으로 열었어요."); }
      else setMessage("설계를 불러오지 못했어요. 다시 접속해 주세요.");
    });
    return () => { active = false; void saveRef.current(); };
  }, [lessonNumber, key]);
  useEffect(() => { if (!ready) return; const timer = setTimeout(() => void saveRef.current(), 1500); return () => clearTimeout(timer); }, [revision, ready]);
  useEffect(() => {
    const sync = () => void saveRef.current(); const hidden = () => { if (document.visibilityState === "hidden") sync(); };
    window.addEventListener("online", sync); window.addEventListener("pagehide", sync); document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("online", sync); window.removeEventListener("pagehide", sync); document.removeEventListener("visibilitychange", hidden); };
  }, []);

  const editTextFields = <div className="stack">{(["building_name", "reason", "description"] as const).map((field, index) => <label key={field}>{["건축물 이름", "설계 이유", "건축물 설명"][index]}<textarea className="field" maxLength={2000} value={building[field]} onChange={event => edit({ ...building, [field]: event.target.value, submitted: false })} /></label>)}</div>;
  const parsed = splitLayerNote(building.layer_notes[activeFloor] ?? "");
  const editFloor = <div className="stack"><div className="toolbar-row" role="tablist" aria-label="층 선택">{building.layer_notes.map((_, index) => <button key={index} type="button" role="tab" aria-selected={activeFloor === index} className={`btn btn-sm ${activeFloor === index ? "btn-primary" : ""}`} onClick={() => setActiveFloor(index)}>{index + 1}층</button>)}</div><strong>{activeFloor + 1}층 공간</strong><label>공간 이름<input className="field" maxLength={200} value={parsed.name} onChange={event => edit({ ...building, layer_notes: building.layer_notes.map((note, index) => index === activeFloor ? joinLayerNote(event.target.value, parsed.description) : note), submitted: false })} /></label><label>공간 설명<textarea className="field" maxLength={1800} value={parsed.description} onChange={event => edit({ ...building, layer_notes: building.layer_notes.map((note, index) => index === activeFloor ? joinLayerNote(parsed.name, event.target.value) : note), submitted: false })} /></label></div>;
  const projectionData = { projections: project(building.blocks, builderGrid), layers: toLayers(building.blocks, builderGrid) };

  return <main className="screen app-max stack architecture-page">
    <h1>{isDesignLesson ? "10차시 · 나만의 건축물 설계하기" : "11차시 · 나만의 건축물 소개서 만들기"}</h1><Link to="/world">공간과 입체 월드</Link>
    <p role="status">{message || (!ready ? "설계를 불러오고 있어요." : isDesignLesson ? "건축물을 구상하고 설계해 보세요." : "10차시 설계를 다듬어 소개서를 완성해 보세요.")}</p>
    {ready && isDesignLesson && <><div className="world-layout"><section className="stack"><p className="muted">② 3D 건축 설계 · {builderGrid.gridWidth}×{builderGrid.gridDepth} · 최대 3층</p><ActivityBuilder grid={builderGrid} blocks={building.blocks} onChange={blocks => edit({ ...building, blocks, submitted: false })} /></section><section className="panel stack"><h2>① 건축물 구상</h2>{editTextFields}<h2>③ 층별 공간 정하기</h2>{editFloor}<button className="btn" disabled={busy} onClick={() => void save()}>10차시 설계 저장</button></section></div><section className="panel"><strong>11차시 안내</strong><p className="muted">설계를 저장한 뒤 11차시에서 외부 모습과 층별 설명을 다듬어 소개서를 완성해요.</p></section></>}
    {ready && !isDesignLesson && <><section className="panel stack architecture-presentation"><h2>나만의 건축물 소개서</h2><h3>{building.building_name || "이름을 지어 주세요"}</h3><p>{building.reason}</p><p>{building.description}</p><Representations given={projectionData} /><div className="stack">{building.layer_notes.map((note, index) => { const floor = splitLayerNote(note); return <p key={index}><strong>{index + 1}층 · {floor.name || "공간 이름을 지어 주세요"}</strong>{floor.description && ` — ${floor.description}`}</p>; })}</div><p className="status-chip">{building.submitted ? "완성된 소개서" : "작성 중인 소개서"}</p></section><section className="panel stack"><h2>소개서 다듬기</h2>{editTextFields}{editFloor}<div className="toolbar-row"><button className="btn" disabled={busy} onClick={() => void save()}>설계 저장</button><button className="btn btn-primary" disabled={busy} onClick={() => void save(true)}>소개서 완성</button><button className="btn" onClick={() => setShowBuilder(value => !value)}>{showBuilder ? "3D 설계 닫기" : "건축물 수정하기"}</button></div></section>{showBuilder && <section className="panel"><ActivityBuilder grid={builderGrid} blocks={building.blocks} onChange={blocks => edit({ ...building, blocks, submitted: false })} /></section>}</>}
  </main>;
}
