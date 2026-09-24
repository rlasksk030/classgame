import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { SEED_PROBLEMS, type SeedProblem } from "@shared/seedProblems.ts";
import { DIRECTION_LABELS } from "@shared/spatialConventions.ts";
import { lessonTitle } from "@shared/lessons.ts";
import BlockWorld from "../components/world/BlockWorld";
import Representations from "../features/activities/Representations";

/**
 * 차시 단위 학생 화면 미리보기 (Teacher Page Expansion Phase 4 B3).
 *
 * 완전히 읽기 전용: SEED_PROBLEMS(정적 커리큘럼 데이터)만 사용하고
 * student-api를 전혀 호출하지 않는다 -- 이 파일은 sb_student_progress /
 * sb_problem_attempts / sb_student_rewards / sb_projects 등 어떤 학생 쓰기
 * 테이블에도 접근하지 않으므로, 구조적으로 진도·시도·보상·프로젝트 데이터를
 * 오염시킬 수 없다 (기존 TeacherProblemPreview.tsx와 같은 안전 패턴).
 * 실제 3-TRY 채점/정답 공개 흐름은 재현하지 않고, 학생이 보는 문제·자료·
 * 3D 모형과 정답을 교사가 미리 훑어볼 수 있게만 한다.
 */
function stageOf(problem: SeedProblem): "concept" | "check" | "more" {
  if (problem.stage) return problem.stage;
  return problem.orderIndex <= 1 ? "concept" : problem.orderIndex === 2 ? "check" : "more";
}

const STAGE_LABEL: Record<"concept" | "check" | "more", string> = {
  concept: "① 개념 배우기",
  check: "② 문제 풀기",
  more: "③ 선택 연습(예시)",
};

function describeAnswer(problem: SeedProblem): string {
  const a = problem.answer;
  if (a.kind === "count") return `${a.value}개`;
  if (a.kind === "direction") return DIRECTION_LABELS[a.value] ?? a.value;
  if (a.kind === "choice") return problem.choices[a.index] ?? `보기 ${a.index + 1}`;
  if (a.kind === "blocks") return a.blocks.length ? `쌓기나무 ${a.blocks.length}개 (아래 3D 모형 참고)` : "정해진 모양 없음 (조건만 만족하면 정답)";
  if (a.kind === "projections") return "세 방향 모양 조건 만족 (여러 모양 가능, 아래 자료 참고)";
  if (a.kind === "heightMap") return "숫자 지도 참고";
  if (a.kind === "layers") return "층별 지도 참고";
  return "-";
}

export default function TeacherLessonPreview() {
  const params = useParams();
  const [lesson, setLesson] = useState(Number(params.lesson) || 1);
  const problems = useMemo(
    () => SEED_PROBLEMS.filter((p) => p.lesson === lesson).sort((a, b) => a.orderIndex - b.orderIndex),
    [lesson],
  );
  const [index, setIndex] = useState(0);
  const problem = problems[Math.min(index, problems.length - 1)];

  const changeLesson = (value: number) => {
    setLesson(value);
    setIndex(0);
  };

  return (
    <main className="screen app-max stack">
      <div className="toolbar-row" style={{ justifyContent: "space-between" }}>
        <div>
          <p className="eyebrow">TEACHER PREVIEW · 읽기 전용</p>
          <h1>학생 화면 미리보기</h1>
          <p className="muted">저장되지 않는 미리보기입니다. 학생의 실제 진도·기록에는 영향이 없습니다.</p>
        </div>
        <Link className="btn btn-sm" to="/teacher">교사 관리로</Link>
      </div>

      <section className="panel stack">
        <div className="toolbar-row">
          <label>차시
            <select className="field" value={lesson} onChange={(e) => changeLesson(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}차시 · {lessonTitle(n)}</option>)}
            </select>
          </label>
        </div>
        {problems.length === 0 ? (
          <p className="muted">이 차시에는 기본 제공 문제가 없습니다.</p>
        ) : (
          <div className="toolbar-row" style={{ alignItems: "center" }}>
            <button className="btn btn-sm" type="button" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>이전 문제</button>
            <span className="muted">{index + 1} / {problems.length} · {problem ? STAGE_LABEL[stageOf(problem)] : ""}</span>
            <button className="btn btn-sm" type="button" disabled={index >= problems.length - 1} onClick={() => setIndex((i) => Math.min(problems.length - 1, i + 1))}>다음 문제</button>
          </div>
        )}
      </section>

      {problem && (
        <section className="world-layout">
          <div className="stack">
            <div className="panel stack">
              <h2>{problem.title}</h2>
              <p>{problem.prompt}</p>
              <span className="status-chip ready">학생에게 표시되는 문제</span>
            </div>
            <BlockWorld
              grid={problem.grid}
              blocks={problem.answer.kind === "blocks" && problem.answer.blocks.length ? problem.answer.blocks : problem.givenBlocks}
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
            <h3>정답 (교사용)</h3>
            <p>{describeAnswer(problem)}</p>
            {problem.explanation && <p className="muted">{problem.explanation}</p>}
            {problem.hint && <p className="muted">힌트: {problem.hint}</p>}
          </div>
        </section>
      )}
    </main>
  );
}
