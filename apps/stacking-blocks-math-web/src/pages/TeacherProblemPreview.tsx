import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { generatePracticeProblems, getProblemTemplates } from "@shared/practiceGenerator.ts";
import { problemTemplateLabel } from "@shared/problemMetadata.ts";
import type { ProblemPresentation } from "@shared/problemPresentation.ts";
import type { ProblemType, StudentProblem } from "@shared/types.ts";
import { lessonTitle } from "@shared/lessons.ts";
import BlockWorld from "../components/world/BlockWorld";
import Representations from "../features/activities/Representations";

/** 교사가 저장 전에 학생에게 보일 정보를 실제 컴포넌트로 확인하는 미리보기입니다. */
export default function TeacherProblemPreview() {
  const [lesson, setLesson] = useState(3);
  const [seed, setSeed] = useState(1);
  const templates = useMemo(() => getProblemTemplates(lesson), [lesson]);
  const [templateId, setTemplateId] = useState(templates[0]?.templateId ?? "");
  const problem = useMemo(() => {
    const generated = generatePracticeProblems(lesson, 40, seed);
    const selected = generated.find(item => item.templateId === templateId) ?? generated[0];
    return selected ? { ...selected, id: selected.code } as StudentProblem : undefined;
  }, [lesson, seed, templateId]);

  const changeLesson = (value: number) => {
    setLesson(value);
    setTemplateId(getProblemTemplates(value)[0]?.templateId ?? "");
  };

  return <main className="screen app-max stack">
    <div className="toolbar-row" style={{ justifyContent: "space-between" }}>
      <div><p className="eyebrow">TEACHER PREVIEW</p><h1>문제 미리보기</h1></div>
      <Link className="btn btn-sm" to="/teacher">교사 관리로</Link>
    </div>
    <section className="panel stack">
      <p className="muted">학생 화면에서 보이는 3D 모형, 자료, 문제 입력 방식을 저장 전에 확인하세요.</p>
      <div className="toolbar-row">
        <label>차시<select value={lesson} onChange={event => changeLesson(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => <option key={index} value={index + 1}>{index + 1}차시 · {lessonTitle(index + 1)}</option>)}</select></label>
        <label>문제 틀<select value={templateId} onChange={event => setTemplateId(event.target.value)}>{templates.map(template => <option key={template.templateId} value={template.templateId}>{problemTemplateLabel(template.templateId)}</option>)}</select></label>
        <label>문제 번호<input type="number" min={0} max={9999} value={seed} onChange={event => setSeed(Math.max(0, Number(event.target.value) || 0))} /></label>
      </div>
    </section>
    {!problem ? <p className="muted">선택한 조건으로 문제를 만들 수 없습니다.</p> : <section className="world-layout">
      <div className="stack">
        <div className="panel stack"><h2>{problem.title}</h2><p>{problem.prompt}</p><span className="status-chip ready">학생에게 표시되는 문제</span></div>
        <BlockWorld
          grid={problem.grid}
          blocks={problem.givenBlocks}
          selected={null}
          layerMax={null}
          preset={problem.given.allowRotate === false ? "front" : "home"}
          onPreset={() => undefined}
          onBlocksChange={() => undefined}
          onSelect={() => undefined}
          onMessage={() => undefined}
          disabled
          allowRotate={problem.given.allowRotate !== false}
        />
      </div>
      <div className="panel stack">
        <h2>학생에게 제공되는 정보</h2>
        <Representations given={problem.given} />
        {problem.presentation?.instructions.map(instruction => <p className="muted" key={instruction}>{instruction}</p>)}
        <h3>답안 방식</h3>
        <p>{answerInputLabel(problem.presentation?.answerInput, problem.problemType)}</p>
        <div className="answer-box preview-answer-box" aria-label="학생 답안 미리보기">
          <span className="muted">이 영역에 학생용 입력 UI가 표시됩니다.</span>
          <button className="btn" type="button" disabled>정답 확인</button>
        </div>
      </div>
    </section>}
  </main>;
}

function answerInputLabel(input: ProblemPresentation["answerInput"] | undefined, type: ProblemType) {
  if (input === "BLOCK_BUILD") return "3D 쌓기나무로 만들기";
  if (input === "THREE_GRIDS") return "위·앞·옆 격자 그리기";
  if (input === "GRID") return "격자에 모양 그리기";
  if (input === "HEIGHT_MAP") return "숫자 지도 입력";
  if (input === "LAYER_MAP") return "층별 격자 입력";
  if (input === "NUMBER") return "숫자 입력";
  if (input === "MULTIPLE_CHOICE") return type === "CAMERA_DIRECTION" ? "방향 선택" : "보기 선택";
  return "학생 답안 입력";
}
