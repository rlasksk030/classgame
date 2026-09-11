import ReviewSummary from "../features/activities/ReviewSummary";
import { canonicalize, toLayers } from "@shared/blocks.ts";
import {
  DIRECTIONS,
  PROBLEM_TYPE_LABELS,
  type Grid2D,
  type HeightMap,
  type Direction,
  type ProblemType,
  type RevealedAnswer,
  type StudentProblem,
  type ViewPreset,
} from "@shared/types.ts";
import { DIRECTION_LABELS } from "@shared/spatialConventions.ts";
import { lessonTitle } from "@shared/lessons.ts";
import {
  getLessonProblems,
  getStudentToken,
  getProblemImage,
  getProblem,
  getSnapshot,
  saveSnapshot,
  submitAttempt,
  startNewPracticeSet,
  type GradeFeedback,
  type StudentSubmissionPayload,
} from "../lib/studentApi";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ProjectionGrid } from "../components/world/ProjectionGrid";
import BlockWorld from "../components/world/BlockWorld";

import { draftKey, readDraft, writeDraft, acknowledgeDraft } from "../lib/snapshotDraft";

type ProblemAttempt = {
  wrongCount: number;
  hintShown: boolean;
  answerRevealed: boolean;
  completed: boolean;
  hint: string | null;
  revealedAnswer: RevealedAnswer | null;
};

function createBoolGrid(rows: number, cols: number, fill = false): Grid2D {
  return Array.from({ length: rows }, () => Array(cols).fill(fill));
}

function emptyGridFor(problem: StudentProblem, key: "top" | "front" | "side" | "heightMap"): Grid2D {
  const spec = problem.presentation?.gridSpecs[key];
  if (spec) return createBoolGrid(spec.rows, spec.cols);
  if (key === "top") return createBoolGrid(problem.grid.gridDepth, problem.grid.gridWidth);
  if (key === "front") return createBoolGrid(problem.grid.maxHeight, problem.grid.gridWidth);
  if (key === "side") return createBoolGrid(problem.grid.maxHeight, problem.grid.gridDepth);
  return createBoolGrid(problem.grid.gridDepth, problem.grid.gridWidth);
}

function isBuildType(problemType: ProblemType) {
  return [
    "FREE_BUILD",
    "BUILD_FROM_VIEWS",
    "BUILD_FROM_HEIGHTMAP",
    "BUILD_FROM_LAYERS",
  ].includes(problemType);
}

function normalizeDirection(raw: string): Direction {
  return raw === "left" || raw === "right" || raw === "top" || raw === "front" || raw === "back" ? raw : "front";
}

const DEFAULT_ATTEMPT_STATE: ProblemAttempt = {
  wrongCount: 0,
  hintShown: false,
  answerRevealed: false,
  completed: false,
  hint: null,
  revealedAnswer: null,
};

export default function LessonPage() {
  const navigate = useNavigate();
  const { lesson } = useParams();
  const lessonNum = Number(lesson ?? 1);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<GradeFeedback | null>(null);
  const [problemIndex, setProblemIndex] = useState(0);

  const [problems, setProblems] = useState<StudentProblem[]>([]);
  const [wrongProblemIds, setWrongProblemIds] = useState<string[]>([]);
  const [stageFilter, setStageFilter] = useState<"all"|"concept"|"check"|"more">("all");
  const [requiredComplete, setRequiredComplete] = useState(false);
  const [problemImage,setProblemImage]=useState("");
  const [problem, setProblem] = useState<StudentProblem | null>(null);
  const [seedMode, setSeedMode] = useState(false);

  const [blocks, setBlocks] = useState<StudentProblem["givenBlocks"]>([]);
  const [selection, setSelection] = useState<StudentProblem["givenBlocks"][number] | null>(null);
  const [extraInformation, setExtraInformation] = useState(false);
  const [preset, setPreset] = useState<ViewPreset>("home");
  const [layerFilter, setLayerFilter] = useState<number | null>(null);

  const [countInput, setCountInput] = useState("");
  const [directionValue, setDirectionValue] = useState<Direction>("front");
  const [choiceIndex, setChoiceIndex] = useState(0);

  const [topMap, setTopMap] = useState<Grid2D>(createBoolGrid(4, 4));
  const [frontMap, setFrontMap] = useState<Grid2D>(createBoolGrid(4, 4));
  const [sideMap, setSideMap] = useState<Grid2D>(createBoolGrid(4, 4));
  const [heightMap, setHeightMap] = useState<HeightMap>(createBoolGrid(4, 4).map((r) => r.map(() => 0)));
  const [layerMaps, setLayerMaps] = useState<Grid2D[]>([]);
  const visibleProblems = useMemo(() => stageFilter === "all" ? problems : problems.filter(item => item.stage === stageFilter), [problems, stageFilter]);
  const currentStage = problem?.stage ?? (stageFilter === "all" ? "concept" : stageFilter);
  const stageProblems = useMemo(() => problems.filter(item => item.stage === currentStage), [problems, currentStage]);
  const stageIndex = problem ? stageProblems.findIndex(item => item.id === problem.id) : -1;
  const stageLabel = currentStage === "concept" ? "개념 익히기" : currentStage === "check" ? "개념 확인" : "더 풀어보기";

  const [attempt, setAttempt] = useState<ProblemAttempt>(DEFAULT_ATTEMPT_STATE);
  const attemptRef = useRef(attempt);
  const restoreToken = useRef(0);

  const blocksRef = useRef<StudentProblem["givenBlocks"]>([]);
  const undoStack = useRef<StudentProblem["givenBlocks"][]>([]);
  const redoStack = useRef<StudentProblem["givenBlocks"][]>([]);

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  useEffect(() => {
    attemptRef.current = attempt;
  }, [attempt]);

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

  const setBlocksWithHistory = (next: StudentProblem["givenBlocks"]) => {
    undoStack.current.push(blocksRef.current);
    redoStack.current = [];
    blocksRef.current = next;
    setBlocks(next);
    if (problem) {
      const saved = writeDraft(draftKey(getStudentToken(), problem.id), next);
      setSaveStatus(saved ? "현재 기기에 임시 저장했어요." : "기기 저장 공간을 확인해 주세요. 화면을 닫기 전에 저장해 주세요.");
    }
  };

  const buildProblemSubmission = (current: StudentProblem): StudentSubmissionPayload | null => {
    if (isBuildType(current.problemType)) {
      return { kind: "blocks", blocks };
    }

    if (current.problemType === "CAMERA_DIRECTION") {
      return { kind: "direction", direction: directionValue };
    }

    if (current.problemType === "CHOICE") {
      return { kind: "choice", index: choiceIndex };
    }

    if (current.problemType === "PROJECTION_DRAW") {
      return {
        kind: "projections",
        projections: {
          top: topMap,
          front: frontMap,
          side: sideMap,
        },
      };
    }

    if (current.problemType === "COUNT" || current.problemType === "COUNT_AMBIGUOUS") {
      const n = Number(countInput);
      if (!countInput.trim() || !Number.isInteger(n) || n < 0) return null;
      return { kind: "count", value: n };
    }

    if (current.problemType === "HEIGHTMAP_FROM_BUILD") {
      return { kind: "heightMap", heightMap };
    }

    if (current.problemType === "LAYER_DRAW") {
      return { kind: "layers", layers: layerMaps };
    }

    return null;
  };

  const updateLayer = (index: number, next: Grid2D) => {
    setLayerMaps((prev) => {
      const cloned = prev.map((layer) => layer.map((row) => [...row]));
      cloned[index] = next;
      return cloned;
    });
  };

  const applyProblem = (next: StudentProblem) => {
    setRestoring(true);
    setProblem(next);
    setSelection(null);
    setExtraInformation(false);
    setPreset(next.given.allowRotate === false ? "front" : "home");
    setMessage(null);
    setResult(null);
    setCountInput("");
    setChoiceIndex(0);
    setDirectionValue((next.given?.shownFrom ?? "front") as Direction);
    setAttempt(DEFAULT_ATTEMPT_STATE);

    const layers = toLayers(next.startBlocks, next.grid);

    clearHistory();
    setBlocks(next.startBlocks);
    setTopMap(next.given?.projections?.top ? next.given.projections.top.map(row => [...row]) : emptyGridFor(next, "top"));
    setFrontMap(
      next.given?.projections?.front ? next.given.projections.front.map(row => [...row]) : emptyGridFor(next, "front"),
    );
    setSideMap(
      next.given?.projections?.side ? next.given.projections.side.map(row => [...row]) : emptyGridFor(next, "side"),
    );
    setHeightMap(next.given?.heightMap ? next.given.heightMap.map(row => [...row]) : emptyGridFor(next, "heightMap").map((row) => row.map(() => 0)));
    setLayerMaps(layers.map((row) => row.map((r) => [...r])));
    setLayerFilter(null);

    void restoreProblemState(next);
  };

  const restoreProblemState = useCallback(
    async (next: StudentProblem) => {
      const token = ++restoreToken.current;

      if (next.id.startsWith("seed:")) { setRestoring(false); return; }

      try {
        const [snapshotPayload, envelope] = await Promise.all([
          getSnapshot(next.id),
          getProblem(next.id, lessonNum),
        ]);

        if (restoreToken.current !== token) return;

        const local = readDraft(draftKey(getStudentToken(), next.id));
        if (local?.dirty) { setBlocks(canonicalize(local.blocks)); }
        else if (snapshotPayload.snapshot && Array.isArray(snapshotPayload.snapshot.blocks)) {
          setBlocks(canonicalize(snapshotPayload.snapshot.blocks as StudentProblem["givenBlocks"]));
        } else {
          setBlocks(next.startBlocks);
        }

        setAttempt({
          wrongCount: envelope.attempt.wrongCount,
          hintShown: envelope.attempt.hintShown,
          answerRevealed: envelope.attempt.answerRevealed,
          completed: envelope.attempt.completed,
          hint: envelope.hint,
          revealedAnswer: envelope.revealedAnswer ?? null,
        });

        if (envelope.attempt.completed) {
          setMessage("이 문제는 이미 완료했습니다.");
        } else if (envelope.attempt.answerRevealed) {
          setMessage("정답이 공개된 상태입니다. 정답 모양대로 다시 쌓아보세요.");
        } else if (envelope.attempt.hintShown) {
          setMessage("이전 시도에서 힌트가 공개되었어요.");
        }
      } catch {
        if (next.id.startsWith("seed:")) return;
        if (restoreToken.current !== token) return;
        const local = readDraft(draftKey(getStudentToken(), next.id));
        if (local) setBlocks(canonicalize(local.blocks));
        setSaveStatus("현재 기기에 임시 저장했어요. 인터넷이 연결되면 다시 저장할게요.");
      } finally {
        if (restoreToken.current === token) setRestoring(false);
      }
    },
    [lessonNum],
  );

  const flushSnapshot = useCallback(async () => {
    if (!problem || restoring) return;
    if (problem.id.startsWith("seed:")) return;
    const key = draftKey(getStudentToken(), problem.id);
    const draft = readDraft(key);
    if (!draft?.dirty) return;

    try {
      await saveSnapshot(
        problem.id,
        lessonNum,
        draft.blocks,
        problem.grid.gridWidth,
        problem.grid.gridDepth,
        problem.grid.maxHeight,
      );
      acknowledgeDraft(key, draft.revision);
      setSaveStatus("저장했어요.");
    } catch {
      setSaveStatus("현재 기기에 임시 저장했어요. 인터넷이 연결되면 다시 저장할게요.");
    }
  }, [blocks, lessonNum, problem, restoring]);

  useEffect(()=>{let active=true;setProblemImage("");if(problem?.hasImage)void getProblemImage(problem.id).then(data=>{if(active)setProblemImage(data.url);}).catch(()=>setMessage("문제 그림을 불러오지 못했습니다. 다시 접속해 주세요."));return()=>{active=false;};},[problem?.id]);

  const clearHistory = () => {
    undoStack.current = [];
    redoStack.current = [];
  };

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      if (lessonNum < 1 || lessonNum > 12) {
        navigate("/world", { replace: true });
        return;
      }

      setLoading(true);
      setMessage(null);
      try {
        const list = await getLessonProblems(lessonNum);
        if (cancelled) return;

        const parsed = list.problems ?? [];
        setSeedMode(list.seedFallback);
        setProblems(parsed);
        setRequiredComplete(Boolean(list.requiredComplete));
        setStageFilter("all");

        if (parsed.length > 0) {
          setProblemIndex(0);
          applyProblem(parsed[0]);
        } else {
          setProblem(null);
        }
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "문제를 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    };

    boot();
    return () => {
      cancelled = true;
    };
  }, [lessonNum, navigate]);

  useEffect(() => {
    if (!problem || visibleProblems.length <= 1) return;
    if (problemIndex < 0 || problemIndex >= visibleProblems.length) return;

    const current = visibleProblems[problemIndex];
    if (current.id !== problem.id) {
      applyProblem(current);
    }
  }, [problemIndex, visibleProblems, problem]);

  useEffect(() => { setProblemIndex(0); }, [stageFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void flushSnapshot();
    }, 1500);

    return () => clearTimeout(timer);
  }, [flushSnapshot]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void flushSnapshot();
      }
    };

    const retry = () => { void flushSnapshot(); };
    window.addEventListener("online", retry);
    window.addEventListener("pagehide", retry);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("pagehide", retry);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [flushSnapshot]);

  const submit = async () => {
    if (!problem) return;

    const submission = buildProblemSubmission(problem);
    if (!submission) {
      setMessage("답안을 완성해 주세요.");
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      await flushSnapshot();
      const response = await submitAttempt(problem.id, submission);
      setResult(response.grade);
      setAttempt((prev) => ({
        ...prev,
        wrongCount: response.grade.wrongCount,
        hintShown: prev.hintShown || response.grade.hint != null,
        answerRevealed: prev.answerRevealed || response.grade.revealedAnswer != null,
        completed: response.grade.completed,
        hint: response.grade.hint ?? prev.hint,
        revealedAnswer: response.grade.revealedAnswer ?? prev.revealedAnswer,
      }));
      setMessage(response.grade.message);
      if (!response.grade.correct) setWrongProblemIds(current => current.includes(problem.id) ? current : [...current, problem.id]);
      if (response.grade.completed && problem.stage !== "more") {
        const refreshed = await getLessonProblems(lessonNum).catch(() => null);
        if (refreshed) setRequiredComplete(Boolean(refreshed.requiredComplete));
      }

      if (response.grade.completed && visibleProblems.length > 0 && !response.grade.needsRebuild && problem.given.allowRotate !== false) {
        if (problemIndex + 1 < visibleProblems.length) {
          setTimeout(() => {
            setProblemIndex((next) => next + 1);
          }, 700);
        }
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "채점 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const doUndo = () => {
    if (!canUndo) return;
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(blocksRef.current);
    setBlocks(prev);
    blocksRef.current = prev;
    if (problem) writeDraft(draftKey(getStudentToken(), problem.id), prev);
  };

  const doRedo = () => {
    if (!canRedo) return;
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(blocksRef.current);
    setBlocks(next);
    blocksRef.current = next;
    if (problem) writeDraft(draftKey(getStudentToken(), problem.id), next);
  };

  const doReset = () => {
    if (!problem || !window.confirm("현재 상태를 초기화할까요?")) return;
    setBlocksWithHistory(problem.startBlocks);
    setSelection(null);
    setResult(null);
    setMessage("초기화되었습니다.");
  };

  const renderEditor = () => {
    if (!problem) return null;

    if (problem.problemType === "CHOICE") {
      return (
        <div className="answer-box">
          {problem.choices.map((choice, index) => (
            <button
              key={`${problem.id}-choice-${index}`}
              className={`btn btn-sm ${choiceIndex === index ? "btn-primary" : ""}`}
              onClick={() => setChoiceIndex(index)}
              type="button"
            >
              {index + 1}. {choice}
            </button>
          ))}
        </div>
      );
    }

    if (problem.problemType === "CAMERA_DIRECTION") {
      return (
        <div className="answer-box">
          {DIRECTIONS.map((dir) => (
            <button
              key={dir}
              type="button"
              className={`btn btn-sm ${directionValue === dir ? "btn-primary" : ""}`}
              onClick={() => setDirectionValue(normalizeDirection(dir))}
            >
              {DIRECTION_LABELS[dir]}
            </button>
          ))}
        </div>
      );
    }

    if (problem.problemType === "COUNT" || problem.problemType === "COUNT_AMBIGUOUS") {
      return (
        <div className="answer-box">
          <input
            className="field"
            value={countInput}
            onChange={(e) => setCountInput(e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            placeholder="정답을 입력"
          />
        </div>
      );
    }

    if (problem.problemType === "PROJECTION_DRAW") {
      const faces = (Object.keys(problem.presentation?.gridSpecs ?? {}) as ("top" | "front" | "side")[]).filter(face => ["top", "front", "side"].includes(face));
      return (
        <div className="answer-box">
          {faces.includes("top") && <ProjectionGrid title="위에서 본 모양" rows={topMap} editable onChange={next => setTopMap(next as Grid2D)} valueType="boolean" />}
          {faces.includes("front") && <ProjectionGrid title="앞에서 본 모양" reverseRows rows={frontMap} editable onChange={next => setFrontMap(next as Grid2D)} valueType="boolean" />}
          {faces.includes("side") && <ProjectionGrid title="옆에서 본 모양" reverseRows rows={sideMap} editable onChange={next => setSideMap(next as Grid2D)} valueType="boolean" />}
        </div>
      );
    }

    if (problem.problemType === "HEIGHTMAP_FROM_BUILD") {
      return (
        <div className="answer-box">
          <ProjectionGrid title="숫자 지도" rows={heightMap} editable onChange={next => setHeightMap(next as HeightMap)} valueType="number" />
        </div>
      );
    }

    if (problem.problemType === "LAYER_DRAW") {
      return (
        <div className="answer-box">
          {layerMaps.map((layer, index) => (
            <ProjectionGrid
              key={`${problem.id}-layer-${index}`}
              title={`${index + 1}층`}
              rows={layer}
              editable
              valueType="boolean"
              onChange={(next) => updateLayer(index, next as Grid2D)}
            />
          ))}
        </div>
      );
    }

    return <p className="muted">정답 입력창이 없으면 직접 조작 후 정답 확인을 눌러주세요.</p>;
  };

  const allowLayer = !!problem?.given.allowLayerView;
  const totalLayerButtons = useMemo(() => {
    if (!problem) return [] as number[];
    return Array.from({ length: Math.max(1, problem.grid.maxHeight) }, (_, idx) => idx + 1);
  }, [problem?.grid.maxHeight]);

  const renderEvidence = () => {
    if (!problem) return null;
    const evidence = problem.given;
    const faces = (["top", "front", "side"] as const).filter(face => evidence.projections?.[face]);
    if (!faces.length && !evidence.heightMap && !evidence.layers?.length) return null;
    return <div className="panel stack" aria-label="문제에서 함께 제시한 정보">
      <strong>함께 제시된 정보</strong>
      <div className="toolbar-row" style={{ alignItems: "flex-start" }}>
        {faces.map(face => <ProjectionGrid key={face} title={{ top: "위에서 본 조건", front: "앞에서 본 조건", side: "옆에서 본 조건" }[face]} rows={evidence.projections![face]!} reverseRows={face !== "top"} editable={false} onChange={() => undefined} valueType="boolean" />)}
        {evidence.heightMap && <ProjectionGrid title="표시된 숫자 지도" rows={evidence.heightMap} editable={false} onChange={() => undefined} valueType="number" />}
        {evidence.layers?.map((rows, index) => <ProjectionGrid key={`evidence-layer-${index}`} title={`${index + 1}층 모양`} rows={rows} editable={false} onChange={() => undefined} valueType="boolean" />)}
      </div>
    </div>;
  };

  if (loading) {
    return <div className="screen app-max"><p className="muted">문제를 불러오는 중…</p></div>;
  }

  if (!problem) {
    return (
      <div className="screen app-max">
        <div className="stack">
          <h1>문제가 없습니다</h1>
          <p className="muted">현재 차시는 준비되지 않았습니다.</p>
          <button className="btn" onClick={async () => { await flushSnapshot(); navigate("/world", { replace: true }); }}>
            월드로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen app-max">
      <div className="stack" style={{ gap: 16 }}>
        <div className="toolbar-row" style={{ justifyContent: "space-between" }}>
          <h1>
            {lessonNum}차시 · {lessonTitle(lessonNum)}
          </h1>
          <button className="btn btn-sm" onClick={async () => { await flushSnapshot(); navigate("/world", { replace: true }); }}>
            월드로
          </button>
        </div>

        <p className="muted">
          {problem.title}
          {seedMode ? " (기본문제)" : ""}
        </p>

        <section className="panel stack" aria-label="차시 학습 단계">
          <strong>학습 단계</strong>
          <div className="toolbar-row">
            {([['all','전체 학습'],['concept','개념 익히기'],['check','개념 확인'],['more','더 풀어보기']] as const).map(([value,label])=><button key={value} className={`btn btn-sm ${stageFilter===value?'btn-primary':''}`} disabled={value==='more'&&!requiredComplete} onClick={()=>setStageFilter(value)}>{label} {value==='more'&&!requiredComplete?'(필수 학습 후 열림)':''}</button>)}
          </div>
          <p className="muted">개념 {problems.filter(item=>item.stage==='concept').length} · 확인 {problems.filter(item=>item.stage==='check').length} · 추가 {problems.filter(item=>item.stage==='more').length}문제{requiredComplete?' · 필수 학습 완료':' · 개념 확인을 먼저 완료해 주세요.'}</p>
          {requiredComplete && problems.some(item => item.stage === 'more') && (
            <div className="toolbar-row">
              <button className="btn btn-sm" disabled={!wrongProblemIds.length} onClick={() => {
                const more = problems.filter(item => item.stage === 'more');
                const index = more.findIndex(item => wrongProblemIds.includes(item.id));
                setStageFilter('more');
                if (index >= 0) setProblemIndex(index);
              }}>
                틀린 문제 다시 풀기{wrongProblemIds.length ? ` (${wrongProblemIds.length})` : ''}
              </button>
              <button className="btn btn-sm" onClick={() => setStageFilter('more')}>유사 문제 풀기</button>
              <button className="btn btn-sm" disabled={busy} onClick={async () => {
                setBusy(true);
                try {
                  await startNewPracticeSet(lessonNum);
                  const refreshed = await getLessonProblems(lessonNum);
                  setProblems(refreshed.problems);
                  setRequiredComplete(Boolean(refreshed.requiredComplete));
                  setStageFilter('more');
                  setProblemIndex(0);
                  const first = refreshed.problems.find(item => item.stage === 'more');
                  if (first) applyProblem(first);
                  setWrongProblemIds([]);
                  setMessage('새 문제 세트를 준비했어요.');
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : '새 문제를 준비하지 못했습니다.');
                } finally {
                  setBusy(false);
                }
              }}>새 문제 더 풀기</button>
            </div>
          )}
        </section>

        {lessonNum===12 && <ReviewSummary key={`${problemIndex}-${attempt.completed}`} />}
        <div className="world-layout">
          <div className="stack" style={{ gap: 8, minHeight: 560 }}>
            <div className="toolbar-row">
              <button className="btn btn-sm" onClick={doUndo} disabled={!canUndo}>
                ↶ 되돌리기
              </button>
              <button className="btn btn-sm" onClick={doRedo} disabled={!canRedo}>
                ↷ 다시하기
              </button>
              <button className="btn btn-sm" onClick={doReset}>
                전체 초기화
              </button>
              <button className="btn btn-sm" onClick={() => void flushSnapshot()} disabled={restoring}>저장</button>
              <span role="status">{saveStatus}</span>
              <span className="muted">블록 수: {blocks.length}</span>
            </div>

            {allowLayer ? (
              <div className="toolbar-row">
                <button className={`btn btn-sm ${layerFilter === null ? "btn-primary" : ""}`} onClick={() => setLayerFilter(null)}>
                  모든 층
                </button>
                {totalLayerButtons.map((layerNo) => (
                  <button
                    key={layerNo}
                    className={`btn btn-sm ${layerFilter === layerNo ? "btn-primary" : ""}`}
                    onClick={() => setLayerFilter(layerNo)}
                  >
                    {layerNo}층
                  </button>
                ))}
              </div>
            ) : null}

            <BlockWorld
              allowRotate={problem.given.allowRotate !== false || extraInformation}
              grid={problem.grid}
              blocks={isBuildType(problem.problemType) ? blocks : problem.givenBlocks}
              selected={selection}
              layerMax={layerFilter}
              preset={preset}
              onPreset={setPreset}
              onBlocksChange={(next) => {
                setBlocksWithHistory(next);
              }}
              onSelect={(next) => setSelection(next)}
              onMessage={setMessage}
              answerGhost={attempt.revealedAnswer?.blocks ?? result?.revealedAnswer?.blocks}
              disabled={restoring || attempt.completed || !isBuildType(problem.problemType)}
              onSnapshotChange={() => undefined}
            />
          </div>

          <div className="stack" style={{ minWidth: 320, gap: 12 }}>
            <div className="panel">
              <h3>{stageLabel} {Math.max(1, stageIndex + 1)} / {Math.max(1, stageProblems.length)}</h3>
              <p className="muted">{PROBLEM_TYPE_LABELS[problem.problemType]}</p>
              <p>{problem.prompt}</p>
              {problemImage&&<img src={problemImage} alt="선생님이 등록한 문제 그림" style={{maxWidth:"100%"}}/>}
              {renderEvidence()}
              {problem.given.allowRotate === false && <div className="stack">
                <p>{extraInformation ? "이제 돌려 보며 가려진 블록을 확인해 보세요." : "지금은 앞에서 본 모습만 볼 수 있어요. 먼저 판단해 답을 제출해 보세요."}</p>
                <button className="btn" disabled={!result && !attempt.wrongCount && !attempt.completed} onClick={()=>setExtraInformation(true)}>추가 정보 확인</button>
              </div>}
              {problem.problemType === "CAMERA_DIRECTION" && problem.given.projections && (() => {
                const direction = normalizeDirection(problem.given.shownFrom ?? "front");
                const face = direction === "top" ? "top" : direction === "front" || direction === "back" ? "front" : "side";
                const projection = problem.given.projections[face];
                return projection ? <ProjectionGrid title={`${DIRECTION_LABELS[direction]}에서 본 모양`} rows={projection} reverseRows={face !== "top"} editable={false} onChange={() => undefined} valueType="boolean" /> : null;
              })()}
              <div className="answer-box">{renderEditor()}</div>

              <div className="toolbar-row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={submit} disabled={restoring || busy || attempt.completed}>
                  {busy ? "채점 중…" : "정답 확인"}
                </button>
                <button className="btn btn-sm" onClick={() => {
                  void flushSnapshot();
                  if (problemIndex > 0) setProblemIndex((value) => value - 1);
                }} disabled={problemIndex === 0}>
                  이전
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    void flushSnapshot();
                    if (problemIndex < visibleProblems.length - 1) setProblemIndex((value) => value + 1);
                  }}
                  disabled={problemIndex >= visibleProblems.length - 1}
                >
                  다음
                </button>
              </div>

              {attempt.hintShown && attempt.hint ? <p className="muted">힌트: {attempt.hint}</p> : null}

              {attempt.answerRevealed && <div className="panel">
                {attempt.revealedAnswer?.count != null && <p>정답: {attempt.revealedAnswer.count}개</p>}
                {attempt.revealedAnswer?.direction && <p>정답 방향: {DIRECTION_LABELS[normalizeDirection(attempt.revealedAnswer.direction)]}</p>}
                {attempt.revealedAnswer?.choiceIndex != null && <p>정답: {problem.choices[attempt.revealedAnswer.choiceIndex]}</p>}
                {attempt.revealedAnswer?.blocks && <button className="btn" onClick={()=>{setBlocksWithHistory(problem.startBlocks);setSelection(null);setMessage("정답 모양을 살펴보고 직접 다시 쌓아 보세요.");}}>정답 모양대로 다시 쌓기</button>}
                <p>{attempt.revealedAnswer?.explanation}</p>
              </div>}

              {message ? <p className="muted">{message}</p> : null}
              <p className="muted">오답 수: {attempt.wrongCount}</p>

              {result ? (
                <p className="muted">{result.completed ? `완료 + XP ${result.xpEarned}, ⭐ ${result.stars}` : null}</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
