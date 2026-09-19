import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import BlockWorld from "../components/world/BlockWorld";
import { lessonTitle } from "@shared/lessons.ts";
import { ARCHITECTURE_GRID } from "../../shared/activities.ts";
import type { BlockCoord, ViewPreset } from "@shared/types.ts";
import { getStudentToken } from "../lib/studentApi";

const GUIDES: Record<number, { title: string; observe: string; try: string; recap: string }> = {
  1: { title: "위치와 층을 살펴봐요", observe: "블록이 어느 자리와 층에 있는지 찾아보세요.", try: "작업판에 블록을 놓고 오른쪽·위·층을 말해 보세요.", recap: "좌표와 층을 함께 보면 입체의 위치를 정확히 설명할 수 있어요." },
  2: { title: "보는 위치에 따라 달라져요", observe: "같은 모양도 앞·뒤·왼쪽·오른쪽에서 다르게 보여요.", try: "모형을 돌려 네 방향에서 보이는 모습을 비교해 보세요.", recap: "카메라 위치가 바뀌면 보이는 모양도 달라져요." },
  3: { title: "위·앞·옆 모습을 연결해요", observe: "입체를 세 방향에서 보고 2D 모양으로 나타내요.", try: "블록을 놓은 뒤 위·앞·옆 버튼으로 모습을 비교해 보세요.", recap: "옆은 오른쪽에서 본 모양이라는 약속을 지켜요." },
  4: { title: "블록 수를 세는 두 방법", observe: "자리별 높이와 층별 블록 수를 살펴보세요.", try: "한 자리씩 세고, 다시 층별로 세어 같은지 확인해 보세요.", recap: "자리별 높이와 층별 개수는 같은 전체 수를 알려 줘요." },
  5: { title: "보이지 않는 곳도 생각해요", observe: "한 방향에서 보이지 않는 블록이 있을 수 있어요.", try: "앞에서만 본 뒤, 추가 정보를 보고 가능한 모양을 비교해 보세요.", recap: "한 방향 정보만으로 전체 개수가 정해지지 않을 때가 있어요." },
  6: { title: "세 방향 정보로 추측해요", observe: "위·앞·옆 자료가 어떤 조건을 주는지 살펴보세요.", try: "조건을 만족하도록 여러 모양을 직접 만들어 보세요.", recap: "세 방향 자료가 있어도 여러 모양이 가능할 수 있어요." },
  7: { title: "높이 지도로 나타내요", observe: "위에서 본 각 자리에 블록 높이를 숫자로 써요.", try: "블록을 쌓고 각 자리의 높이를 읽어 보세요.", recap: "높이 지도는 각 자리의 블록 수를 한눈에 보여 줘요." },
  8: { title: "층별로 나타내요", observe: "1층부터 한 층씩 모양을 살펴보세요.", try: "층을 바꾸어 보며 모양과 블록 수의 규칙을 찾아보세요.", recap: "층별 표현은 입체의 안쪽 구조와 규칙을 보여 줘요." },
  9: { title: "친구 문제를 만드는 방법", observe: "내 모양과 친구에게 줄 관찰 자료를 정해요.", try: "블록 10개로 모양을 만들고 어떤 자료를 보여 줄지 생각해 보세요.", recap: "좋은 문제는 자료와 질문이 서로 잘 맞아요." },
  10: { title: "건축물을 설계해요", observe: "넓은 설계판에서 외부와 층별 공간을 계획해요.", try: "10×10 작업판에 블록을 놓고 세 층까지 설계해 보세요.", recap: "설계 이유와 공간 설명을 함께 기록하면 작품을 소개하기 쉬워요." },
  11: { title: "건축물 소개서를 만들어요", observe: "외부 모습과 층별 모습을 연결해 설명해요.", try: "완성한 모형의 위·앞·옆 모습을 비교하고 설명을 다듬어 보세요.", recap: "소개서는 모형의 모습과 만든 사람의 생각을 함께 전해요." },
  12: { title: "배운 표현을 되짚어요", observe: "방향·개수·높이 지도·층별 표현을 돌아봐요.", try: "작은 모형을 만들고 여러 표현 방법을 차례로 확인해 보세요.", recap: "입체를 보고 표현하고, 표현을 보고 입체를 추측할 수 있어요." },
};

export default function LessonLearnPage() {
  const { lesson } = useParams();
  const lessonNumber = Math.min(12, Math.max(1, Number(lesson) || 1));
  const guide = GUIDES[lessonNumber] ?? GUIDES[1];
  const navigate = useNavigate();
  const [blocks, setBlocks] = useState<BlockCoord[]>([]);
  const [preset, setPreset] = useState<ViewPreset>("home");
  const grid = useMemo(() => lessonNumber === 10 ? ARCHITECTURE_GRID : { gridWidth: 4, gridDepth: 4, maxHeight: 4 }, [lessonNumber]);

  useEffect(() => {
    if (!getStudentToken()) navigate("/", { replace: true });
  }, [navigate]);

  return <main className="screen app-max stack lesson-learn-page">
    <div className="toolbar-row" style={{ justifyContent: "space-between" }}>
      <div><p className="eyebrow">① 개념 배우기</p><h1>{lessonNumber}차시 · {lessonTitle(lessonNumber)}</h1></div>
      <Link className="btn btn-sm" to="/world">월드로</Link>
    </div>
    <p className="direction-note" role="note">이 단원에서 ‘옆’은 오른쪽에서 본 모양이에요.</p>
    <section className="panel stack" aria-label="개념 배우기 안내">
      <h2>{guide.title}</h2>
      <p><strong>살펴보기</strong> · {guide.observe}</p>
      <p><strong>직접 해 보기</strong> · {guide.try}</p>
      <p><strong>정리</strong> · {guide.recap}</p>
    </section>
    <section className="panel stack" aria-label="안내된 3D 탐구">
      <h2>안내된 탐구</h2>
      <p className="muted">블록을 자유롭게 놓아 보고, 보기 버튼으로 관찰 위치를 바꾸어 보세요. 이 활동의 실수는 오답으로 기록되지 않아요.</p>
      <BlockWorld grid={grid} blocks={blocks} selected={null} layerMax={null} preset={preset} onPreset={setPreset} onBlocksChange={setBlocks} onSelect={() => undefined} onMessage={() => undefined} />
    </section>
    <div className="toolbar-row">
      <button className="btn btn-primary" onClick={() => navigate(lessonNumber === 9 ? "/lesson/9" : `/lesson/${lessonNumber}/solve`)}>② 문제 풀기 시작</button>
      <button className="btn" onClick={() => navigate(`/lesson/${lessonNumber}/practice`)}>③ 더 풀어보기로 이동</button>
    </div>
  </main>;
}
