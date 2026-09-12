import ReviewSummary from "../features/activities/ReviewSummary";
import { canonicalize } from "@shared/blocks.ts";
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
  saveProblemPosition,
  type GradeFeedback,
  type StudentSubmissionPayload,
  type LessonProblemListData,
} from "../lib/studentApi";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ProjectionGrid } from "../components/world/ProjectionGrid";
import BlockWorld from "../components/world/BlockWorld";
import { answerRendererFor } from "@shared/answerUi.ts";
import { problemIndexForId, stageProblemIndex } from "@shared/problemSession.ts";
import { getResolvedSupabaseConfig } from "../lib/config";

import { draftKey, readDraft, writeDraft, acknowledgeDraft } from "../lib/snapshotDraft";
import { duplicateTaskCount } from "../../shared/practiceTask";

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

function projectionFacesFor(problem: StudentProblem): ("top" | "front" | "side")[] {
  const allowed = ["top", "front", "side"] as const;
  const presentationFaces = Object.keys(problem.presentation?.gridSpecs ?? {}).filter((face): face is (typeof allowed)[number] => allowed.includes(face as (typeof allowed)[number]));
  const givenFaces = Object.keys(problem.given.projections ?? {}).filter((face): face is (typeof allowed)[number] => allowed.includes(face as (typeof allowed)[number]));
  const known = [...new Set([...presentationFaces, ...givenFaces])];
  if (known.length || problem.problemType !== "PROJECTION_DRAW") return known;
  // 구버전 Edge Function이 presentation을 내려주지 않아도 문제 문구와
  // givenBlocks만으로 입력 격자를 복원해 제출을 막지 않는다.
  if (problem.prompt.includes("세 방향") || problem.prompt.includes("모두")) return ["top", "front", "side"];
  const inferred: ("top" | "front" | "side")[] = [];
  if (problem.prompt.includes("위")) inferred.push("top");
  if (problem.prompt.includes("앞")) inferred.push("front");
  if (problem.prompt.includes("옆")) inferred.push("side");
  // 방향·정답 자료가 모두 없으면 임의로 세 격자를 만들어 내지 않는다.
  // 이런 문항은 학생에게 오답 불이익을 주지 않고 표시 오류로 중단한다.
  return inferred;
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

type AnswerDraft = {
  countInput?: string;
  directionValue?: Direction;
  choiceIndex?: number;
  topMap?: Grid2D;
  frontMap?: Grid2D;
  sideMap?: Grid2D;
  heightMap?: HeightMap;
  layerMaps?: Grid2D[];
};

function stageCursorKey(lesson: number, stage: "concept" | "check" | "more") {
  const config=getResolvedSupabaseConfig();
  const owner=draftKey(getStudentToken(),'lesson');
  return `sb.lesson.v2.${encodeURIComponent(config?.supabaseUrl??'')}.${config?.installationId??''}.${owner??'signed-out'}.${lesson}.${stage}.problem`;
}

function stageAnswerKey(lesson: number, stage: "concept" | "check" | "more", problemId: string) {
  return `${stageCursorKey(lesson,stage)}.${problemId}.answer`;
}

function readStageCursor(lesson: number, stage: "concept" | "check" | "more") {
  try { return window.sessionStorage.getItem(stageCursorKey(lesson, stage)); } catch { return null; }
}

function saveStageCursor(lesson: number, stage: "concept" | "check" | "more", problemId: string) {
  try { window.sessionStorage.setItem(stageCursorKey(lesson, stage), problemId); } catch { /* private mode */ }
}

function readAnswerDraft(lesson: number, problem: StudentProblem): AnswerDraft | null {
  if (!problem.stage) return null;
  try {
    const raw = window.sessionStorage.getItem(stageAnswerKey(lesson, problem.stage, problem.id));
    return raw ? JSON.parse(raw) as AnswerDraft : null;
  } catch { return null; }
}

function isGridDraft(value: unknown): value is Grid2D {
  return Array.isArray(value) && value.every(row => Array.isArray(row) && row.every(cell => typeof cell === "boolean"));
}

export default function LessonPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { lesson } = useParams();
  const lessonNum = Number(lesson ?? 1);
  const routeStage: "check" | "more" | null = location.pathname.endsWith("/solve") ? "check" : location.pathname.endsWith("/practice") ? "more" : null;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<GradeFeedback | null>(null);
  // 문제 세트 안의 현재 위치는 이 인덱스를 단일 기준으로 유지합니다.
  // `problem`은 인덱스에 맞춰 렌더링되는 현재 문항의 복사본입니다.
  const [problemIndex, setProblemIndex] = useState(0);

  const [problems, setProblems] = useState<StudentProblem[]>([]);
  const [wrongProblemIds, setWrongProblemIds] = useState<string[]>([]);
  // 학생은 한 번에 한 학습 단계의 문항만 풉니다. `all`을 허용하면
  // 개념 문제를 끝내기 전에 확인/추가 문항으로 섞여 들어가고 번호도
  // 단계와 실제 문항 위치가 달라집니다.
  const [stageFilter, setStageFilter] = useState<"concept"|"check"|"more">(routeStage ?? "concept");
  const [requiredComplete, setRequiredComplete] = useState(false);
  const [problemImage,setProblemImage]=useState("");
  const [problem, setProblem] = useState<StudentProblem | null>(null);
  const [seedMode, setSeedMode] = useState(false);
  const [practiceSet, setPracticeSet] = useState<LessonProblemListData['practiceSet']>();

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
  const visibleProblems = useMemo(() => problems.filter(item => item.stage === stageFilter), [problems, stageFilter]);
  const currentStage = problem?.stage ?? stageFilter;
  const stageProblems = useMemo(() => problems.filter(item => item.stage === currentStage), [problems, currentStage]);
  const stageIndex = problem ? stageProblems.findIndex(item => item.id === problem.id) : -1;
  const stageLabel = currentStage === "concept" ? "① 개념 배우기" : currentStage === "check" ? "② 문제 풀기" : "③ 더 풀어보기";

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

  // 단계 페이지를 오가거나 새로고침해도 현재 입력을 같은 문항에만 복원합니다.
  // PIN·세션 같은 민감한 값은 저장하지 않고, 답안 초안만 세션 범위에 둡니다.
  useEffect(() => {
    if (!problem?.stage || problem.id.startsWith("seed:")) return;
    const draft: AnswerDraft = { countInput, directionValue, choiceIndex, topMap, frontMap, sideMap, heightMap, layerMaps };
    try { window.sessionStorage.setItem(stageAnswerKey(lessonNum, problem.stage, problem.id), JSON.stringify(draft)); } catch { /* private mode */ }
  }, [choiceIndex, countInput, directionValue, frontMap, heightMap, layerMaps, lessonNum, problem?.id, problem?.stage, sideMap, topMap]);

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
      const faces = projectionFacesFor(current);
      if (!faces.length) return null;
      const projections: Partial<{ top: Grid2D; front: Grid2D; side: Grid2D }> = {};
      if (faces.includes("top")) projections.top = topMap;
      if (faces.includes("front")) projections.front = frontMap;
      if (faces.includes("side")) projections.side = sideMap;
      return { kind: "projections", projections };
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

    const sourceLayers = next.given?.layers;
    const layerCount = sourceLayers?.length ?? next.grid.maxHeight;
    const layers = Array.from({ length: layerCount }, (_, index) => {
      const source = sourceLayers?.[index];
      return createBoolGrid(source?.length ?? next.grid.gridDepth, source?.[0]?.length ?? next.grid.gridWidth);
    });

    clearHistory();
    setBlocks(next.startBlocks);
    const clearProjectionAnswers = next.problemType === "PROJECTION_DRAW";
    setTopMap(!clearProjectionAnswers && next.given?.projections?.top ? next.given.projections.top.map(row => [...row]) : emptyGridFor(next, "top"));
    setFrontMap(
      !clearProjectionAnswers && next.given?.projections?.front ? next.given.projections.front.map(row => [...row]) : emptyGridFor(next, "front"),
    );
    setSideMap(
      !clearProjectionAnswers && next.given?.projections?.side ? next.given.projections.side.map(row => [...row]) : emptyGridFor(next, "side"),
    );
    setHeightMap(next.given?.heightMap ? next.given.heightMap.map(row => [...row]) : emptyGridFor(next, "heightMap").map((row) => row.map(() => 0)));
    setLayerMaps(layers.map((row) => row.map((r) => [...r])));
    setLayerFilter(null);

    const draft = readAnswerDraft(lessonNum, next);
    if (draft) {
      if (typeof draft.countInput === "string") setCountInput(draft.countInput);
      if (draft.directionValue) setDirectionValue(draft.directionValue);
      if (typeof draft.choiceIndex === "number") setChoiceIndex(draft.choiceIndex);
      if (isGridDraft(draft.topMap)) setTopMap(draft.topMap);
      if (isGridDraft(draft.frontMap)) setFrontMap(draft.frontMap);
      if (isGridDraft(draft.sideMap)) setSideMap(draft.sideMap);
      if (Array.isArray(draft.heightMap)) setHeightMap(draft.heightMap);
      if (Array.isArray(draft.layerMaps) && draft.layerMaps.every(isGridDraft)) setLayerMaps(draft.layerMaps);
    }

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
          setMessage(isBuildType(next.problemType) ? "정답이 공개된 상태입니다. 정답 모양대로 다시 쌓아보세요." : "정답이 공개된 상태입니다. 답을 확인하고 다시 풀어 보세요.");
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
        setPracticeSet(list.practiceSet);
        setProblems(parsed);
        setRequiredComplete(Boolean(list.requiredComplete));
        if (routeStage === "more" && !list.requiredComplete) {
          setMessage("③ 더 풀어보기는 ② 문제 풀기를 완료한 뒤 열려요.");
          navigate(`/lesson/${lessonNum}/solve`, { replace: true });
          return;
        }
        if (parsed.length > 0) {
          const restoredIndex = problemIndexForId(parsed, list.currentProblemId);
          const restoredProblem = parsed[restoredIndex] ?? parsed[0];
          const restoredStage = routeStage ?? restoredProblem?.stage ?? "concept";
          const stageProblems = parsed.filter(item => item.stage === restoredStage);
          const savedId = routeStage ? readStageCursor(lessonNum, restoredStage) : null;
          const stageFirst = stageProblems[stageProblemIndex(parsed,restoredStage,savedId,list.currentProblemId)];
          const selectedProblem = routeStage ? stageFirst ?? restoredProblem : restoredProblem;
          const restoredStageIndex = parsed
            .filter(item => item.stage === restoredStage)
            .findIndex(item => item.id === selectedProblem?.id);
          setStageFilter(restoredStage);
          setProblemIndex(Math.max(0, restoredStageIndex));
          if (selectedProblem) applyProblem(selectedProblem);
        } else {
          setProblem(null);
        }
      } catch (err) {
        if(cancelled) return;
        setMessage(err instanceof Error ? err.message : "문제를 불러오지 못했습니다.");
      } finally {
        if(!cancelled) setLoading(false);
      }
    };

    boot();
    return () => {
      cancelled = true;
      restoreToken.current++;
    };
  }, [lessonNum, navigate, routeStage]);

  useEffect(() => {
    if (!problem || visibleProblems.length <= 1) return;
    if (problemIndex < 0 || problemIndex >= visibleProblems.length) return;

    const current = visibleProblems[problemIndex];
    if (current.id !== problem.id) {
      applyProblem(current);
    }
  }, [problemIndex, visibleProblems, problem]);

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

    } catch (err) {
      setMessage(err instanceof Error ? err.message : "채점 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const moveToStage = (stage: "concept" | "check" | "more") => {
    void flushSnapshot();
    if (stage === "more" && !requiredComplete) {
      setMessage("③ 더 풀어보기는 ② 문제 풀기를 완료한 뒤 열려요.");
      return;
    }
    const stageProblems = problems.filter(item => item.stage === stage);
    const savedId = readStageCursor(lessonNum, stage);
    const first = stageProblems.find(item => item.id === savedId) ?? stageProblems[0];
    if (!first) {
      setMessage("다음 학습 단계가 아직 준비되지 않았어요.");
      return;
    }
    setStageFilter(stage);
    navigate(`/lesson/${lessonNum}/${stage === "check" ? "solve" : stage === "more" ? "practice" : "learn"}`);
    setProblemIndex(Math.max(0, stageProblems.findIndex(item => item.id === first.id)));
    saveStageCursor(lessonNum, stage, first.id);
    applyProblem(first);
    if (!first.id.startsWith("seed:")) void saveProblemPosition(first.id, lessonNum);
  };

  // 완료한 문제도 다음 행동을 선택할 수 있어야 합니다. 제출과 이동을
  // 같은 disabled 조건으로 묶지 않고, 단계의 경계에서는 다음 단계를
  // 명시적으로 안내해 현재 문항 위치가 갑자기 초기화되지 않게 합니다.
  const canNavigate = Boolean(problem && visibleProblems.length > 0 && (problemIndex < visibleProblems.length - 1 || attempt.completed));
  const nextActionLabel = (() => {
    if (!problem || !attempt.completed) return "다음";
    if (problemIndex < visibleProblems.length - 1) return "다음 문제";
    if (currentStage === "concept") return "문제 풀기 시작";
    if (currentStage === "check") return requiredComplete && problems.some(item => item.stage === "more") ? "더 풀어보기 시작" : "차시 결과 보기";
    return "차시 결과 보기";
  })();

  const goNext = () => {
    if (!problem || !canNavigate) return;
    void flushSnapshot();
    if (problemIndex < visibleProblems.length - 1) {
      const next = visibleProblems[problemIndex + 1];
      if (next) {
        if (next.stage) saveStageCursor(lessonNum, next.stage, next.id);
        if (!next.id.startsWith("seed:")) void saveProblemPosition(next.id, lessonNum);
      }
      setProblemIndex(value => value + 1);
      return;
    }
    if (currentStage === "concept") {
      moveToStage("check");
    } else if (currentStage === "check" && requiredComplete && problems.some(item => item.stage === "more")) {
      moveToStage("more");
    } else {
      navigate("/world");
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
      const faces = projectionFacesFor(problem);
      if (!faces.length) return <p role="alert">문제를 표시하지 못했어요. 잠시 뒤 다시 시도해 주세요.</p>;
      return (
        <div className="answer-box">
          {faces.includes("top") && <ProjectionGrid title="위에서 본 모양" rows={topMap} orientation="floor" editable onChange={next => setTopMap(next as Grid2D)} valueType="boolean" />}
          {faces.includes("front") && <ProjectionGrid title="앞에서 본 모양" reverseRows rows={frontMap} editable onChange={next => setFrontMap(next as Grid2D)} valueType="boolean" />}
          {faces.includes("side") && <ProjectionGrid title="옆에서 본 모양(오른쪽)" reverseRows rows={sideMap} editable onChange={next => setSideMap(next as Grid2D)} valueType="boolean" />}
        </div>
      );
    }

    if (problem.problemType === "HEIGHTMAP_FROM_BUILD") {
      return (
        <div className="answer-box">
          <ProjectionGrid title="숫자 지도" rows={heightMap} orientation="floor" editable onChange={next => setHeightMap(next as HeightMap)} valueType="number" />
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
              orientation="floor"
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
  const answerUnavailable = problem?.problemType === "PROJECTION_DRAW" && projectionFacesFor(problem).length === 0;
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
        {faces.map(face => <ProjectionGrid key={face} title={{ top: "위에서 본 조건", front: "앞에서 본 조건", side: "옆에서 본 조건(오른쪽)" }[face]} rows={evidence.projections![face]!} reverseRows={face !== "top"} orientation={face === "top" ? "floor" : undefined} editable={false} onChange={() => undefined} valueType="boolean" />)}
        {evidence.heightMap && <ProjectionGrid title="표시된 숫자 지도" rows={evidence.heightMap} orientation="floor" editable={false} onChange={() => undefined} valueType="number" />}
        {evidence.layers?.map((rows, index) => <ProjectionGrid key={`evidence-layer-${index}`} title={`${index + 1}층 모양`} rows={rows} orientation="floor" editable={false} onChange={() => undefined} valueType="boolean" />)}
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
        <p className="direction-note" role="note">이 단원에서 ‘옆’은 오른쪽에서 본 모양이에요. 앞쪽 기준은 3D 작업판과 자료에서 같아요.</p>

        <section className="panel stack" aria-label="차시 학습 단계">
          <strong>학습 단계</strong>
          <div className="toolbar-row">
            {([['concept','① 개념 배우기'],['check','② 문제 풀기'],['more','③ 더 풀어보기']] as const).map(([value,label])=><button key={value} className={`btn btn-sm ${currentStage===value?'btn-primary':''}`} disabled={value==='more'&&!requiredComplete} onClick={()=>{
              void flushSnapshot();
              navigate(`/lesson/${lessonNum}/${value === 'check' ? 'solve' : value === 'more' ? 'practice' : 'learn'}`);
              setStageFilter(value);
              const stageProblems = problems.filter(item => item.stage === value);
              const savedId = readStageCursor(lessonNum, value);
              const first = stageProblems.find(item => item.id === savedId) ?? stageProblems[0];
              if (first) {
                setProblemIndex(Math.max(0, stageProblems.findIndex(item => item.id === first.id)));
                saveStageCursor(lessonNum, value, first.id);
                applyProblem(first);
                if (!first.id.startsWith('seed:')) void saveProblemPosition(first.id, lessonNum);
              }
            }}>{label} {value==='more'&&!requiredComplete?'(필수 학습 후 열림)':''}</button>)}
          </div>
          <p className="muted">① {problems.filter(item=>item.stage==='concept').length}문제 · ② {problems.filter(item=>item.stage==='check').length}문제 · ③ {problems.filter(item=>item.stage==='more').length}문제{requiredComplete?' · 필수 학습 완료':' · ② 문제 풀기를 먼저 완료해 주세요.'}</p>
          {requiredComplete && problems.some(item => item.stage === 'more') && (
            <div className="toolbar-row">
              <button className="btn btn-sm" disabled={!wrongProblemIds.length} onClick={() => {
                const more = problems.filter(item => item.stage === 'more');
                const index = more.findIndex(item => wrongProblemIds.includes(item.id));
                setStageFilter('more');
                navigate(`/lesson/${lessonNum}/practice`);
                if (index >= 0) {
                  setProblemIndex(index);
                  const target = more[index];
                  if (target) {
                    saveStageCursor(lessonNum, 'more', target.id);
                    applyProblem(target);
                    if (!target.id.startsWith('seed:')) void saveProblemPosition(target.id, lessonNum);
                  }
                }
              }}>
                틀린 문제 다시 풀기{wrongProblemIds.length ? ` (${wrongProblemIds.length})` : ''}
              </button>
              <button className="btn btn-sm" onClick={() => {
                const more = problems.filter(item => item.stage === 'more');
                const first = more[0];
                setStageFilter('more');
                navigate(`/lesson/${lessonNum}/practice`);
                setProblemIndex(0);
                if (first) {
                  saveStageCursor(lessonNum, 'more', first.id);
                  applyProblem(first);
                  if (!first.id.startsWith('seed:')) void saveProblemPosition(first.id, lessonNum);
                }
              }}>유사 문제 풀기</button>
              {practiceSet && <p>기본 추가활동 {practiceSet.supplementalCount}개 · 배정 연습 {practiceSet.targetCount}개 · 현재 연습 {practiceSet.generatedCount}개</p>}
              {practiceSet?.awaitingReplacement && <p>이전에 요청한 새 묶음이 아직 준비되지 않아 이전 묶음을 유지하고 있어요. ‘새 문제 더 풀기’를 선택하면 기록을 보존하고 새 묶음으로 옮겨요.</p>}
              {!practiceSet && <p>새 문제 묶음을 복원할 수 있는 서버인지 확인되지 않아 전환을 멈췄어요. 선생님께 문제 서버 업데이트를 요청해 주세요. 현재 답안과 기록은 보존돼요.</p>}
              {(practiceSet?.requiresRepair || duplicateTaskCount(problems.filter(item=>item.stage==='more'))>0) && <p role="status">이 문제 묶음에 반복 과제가 있거나 새 묶음 전환이 끝나지 않았어요. 기존 답안·XP는 보존됩니다. {practiceSet?.contractVersion===2 ? '‘새 문제 더 풀기’로 수정된 묶음을 시작할 수 있어요.' : '수정된 문제 서버가 아직 연결되지 않았어요. 선생님께 서버 업데이트를 요청해 주세요.'}</p>}
              <button className="btn btn-sm" disabled={busy || practiceSet?.contractVersion!==2} onClick={async () => {
                if (!window.confirm('현재 묶음과 학습 기록을 보존하고 새 문제 묶음을 시작할까요?')) return;
                setBusy(true);
                try {
                  if(!practiceSet) return;
                  await flushSnapshot();
                  await startNewPracticeSet(lessonNum, practiceSet.seed);
                  const refreshed = await getLessonProblems(lessonNum);
                  if(refreshed.practiceSet?.contractVersion!==2 || refreshed.practiceSet.seed===practiceSet?.seed) throw new Error('새 묶음으로 전환됐는지 확인하지 못했어요. 기존 기록은 보존돼요. 다시 접속해 확인해 주세요.');
                  setProblems(refreshed.problems);
                  setPracticeSet(refreshed.practiceSet);
                  setRequiredComplete(Boolean(refreshed.requiredComplete));
                  setStageFilter('more');
                  setProblemIndex(0);
                  const first = refreshed.problems.find(item => item.stage === 'more');
                  if (first) {
                    saveStageCursor(lessonNum, 'more', first.id);
                    applyProblem(first);
                    if (!first.id.startsWith('seed:')) void saveProblemPosition(first.id, lessonNum);
                  }
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
                return projection ? <ProjectionGrid title={`${DIRECTION_LABELS[direction]}에서 본 모양`} rows={projection} reverseRows={face !== "top"} orientation={face === "top" ? "floor" : undefined} editable={false} onChange={() => undefined} valueType="boolean" /> : null;
              })()}
              <div
                className="answer-box"
                data-answer-renderer={problem.presentation ? (answerRendererFor(problem.presentation.answerInput) ?? "missing") : "missing"}
                aria-label="문제 유형에 맞는 답안 입력"
              >{renderEditor()}</div>

              <div className="toolbar-row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={submit} disabled={restoring || busy || attempt.completed || answerUnavailable}>
                  {busy ? "채점 중…" : "정답 확인"}
                </button>
                <button className="btn btn-sm" onClick={() => {
                  void flushSnapshot();
                  if (problemIndex > 0) {
                    const previous = visibleProblems[problemIndex - 1];
                  if (previous && !previous.id.startsWith("seed:")) void saveProblemPosition(previous.id, lessonNum);
                    if (previous?.stage) saveStageCursor(lessonNum, previous.stage, previous.id);
                    setProblemIndex((value) => value - 1);
                  }
                }} disabled={problemIndex === 0}>
                  이전
                </button>
                <button
                  className="btn btn-sm"
                  onClick={goNext}
                  disabled={!canNavigate}
                >
                  {nextActionLabel}
                </button>
              </div>

              {attempt.hintShown && attempt.hint ? <p className="muted">힌트: {attempt.hint}</p> : null}

              {attempt.answerRevealed && <div className="panel">
                {attempt.revealedAnswer?.count != null && <p>정답: {attempt.revealedAnswer.count}개</p>}
                {attempt.revealedAnswer?.direction && <p>정답 방향: {DIRECTION_LABELS[normalizeDirection(attempt.revealedAnswer.direction)]}</p>}
                {attempt.revealedAnswer?.choiceIndex != null && <p>정답: {problem.choices[attempt.revealedAnswer.choiceIndex]}</p>}
                {attempt.revealedAnswer?.projections?.top && <ProjectionGrid title="정답 · 위에서 본 모양" rows={attempt.revealedAnswer.projections.top} orientation="floor" editable={false} onChange={() => undefined} valueType="boolean" />}
                {attempt.revealedAnswer?.projections?.front && <ProjectionGrid title="정답 · 앞에서 본 모양" rows={attempt.revealedAnswer.projections.front} reverseRows editable={false} onChange={() => undefined} valueType="boolean" />}
                {attempt.revealedAnswer?.projections?.side && <ProjectionGrid title="정답 · 옆에서 본 모양(오른쪽)" rows={attempt.revealedAnswer.projections.side} reverseRows editable={false} onChange={() => undefined} valueType="boolean" />}
                {attempt.revealedAnswer?.heightMap && <ProjectionGrid title="정답 · 숫자 지도" rows={attempt.revealedAnswer.heightMap} orientation="floor" editable={false} onChange={() => undefined} valueType="number" />}
                {attempt.revealedAnswer?.layers?.map((rows, index) => <ProjectionGrid key={`revealed-layer-${index}`} title={`정답 · ${index + 1}층`} rows={rows} orientation="floor" editable={false} onChange={() => undefined} valueType="boolean" />)}
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
        {lessonNum===12 && attempt.completed && <ReviewSummary key={`${problemIndex}-${attempt.completed}`} />}
      </div>
    </div>
  );
}
