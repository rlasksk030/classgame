/** 12차시 구성 (명세 21~32). 교과서 흐름을 따르되 문제는 새로 만들었다. */

export type LessonMode = "problems" | "playground" | "project" | "review";

export interface LessonDef {
  lesson: number;
  title: string;
  /** 학습 목표 한 줄. */
  goal: string;
  /** 카드에 보여 줄 짧은 설명. */
  summary: string;
  mode: LessonMode;
  /** 월드 화면 카드 색. */
  accent: string;
  emoji: string;
}

export const LESSONS: LessonDef[] = [
  {
    lesson: 1,
    title: "쌓기나무와 친해지기",
    goal: "쌓기나무의 위치와 층, 개수를 말로 나타낼 수 있다.",
    summary: "오른쪽·위·층을 살펴보고 자유롭게 쌓아 봐요",
    mode: "problems",
    accent: "#6aa84f",
    emoji: "🧱",
  },
  {
    lesson: 2,
    title: "어느 방향에서 본 모양일까요 (1)",
    goal: "보는 방향에 따라 모습이 달라짐을 안다.",
    summary: "앞·뒤·왼쪽·오른쪽에서 본 모습 찾기",
    mode: "problems",
    accent: "#3d85c6",
    emoji: "🧭",
  },
  {
    lesson: 3,
    title: "어느 방향에서 본 모양일까요 (2)",
    goal: "쌓은 모양을 위·앞·옆에서 본 모양으로 나타낼 수 있다.",
    summary: "3D 모양을 보고 격자에 그려 봐요",
    mode: "problems",
    accent: "#674ea7",
    emoji: "📐",
  },
  {
    lesson: 4,
    title: "쌓기나무의 개수 알아보기",
    goal: "자리별 높이와 층별 세기로 개수를 구할 수 있다.",
    summary: "두 가지 방법으로 세어 보고 견주어 봐요",
    mode: "problems",
    accent: "#e69138",
    emoji: "🔢",
  },
  {
    lesson: 5,
    title: "보이지 않는 쌓기나무",
    goal: "한 방향만으로는 개수를 알 수 없는 경우가 있음을 안다.",
    summary: "가려진 자리를 찾아내는 눈 기르기",
    mode: "problems",
    accent: "#a64d79",
    emoji: "🔎",
  },
  {
    lesson: 6,
    title: "세 방향을 보고 쌓아 보기",
    goal: "위·앞·옆에서 본 모양으로 입체를 추측해 쌓을 수 있다.",
    summary: "조건을 만족하면 여러 모양도 정답이에요",
    mode: "problems",
    accent: "#45818e",
    emoji: "🏗️",
  },
  {
    lesson: 7,
    title: "위에서 본 모양에 수 쓰기",
    goal: "각 자리의 층수를 수로 나타내고 그 수로 모양을 만들 수 있다.",
    summary: "숫자 지도로 모양이 하나로 정해져요",
    mode: "problems",
    accent: "#cc4125",
    emoji: "🗺️",
  },
  {
    lesson: 8,
    title: "층별로 나타낸 모양",
    goal: "층별 그림과 입체 모양을 서로 바꾸어 나타낼 수 있다.",
    summary: "1층·2층·3층으로 나누어 생각해요",
    mode: "problems",
    accent: "#7f6000",
    emoji: "🥞",
  },
  {
    lesson: 9,
    title: "쌓기나무 놀이터",
    goal: "친구에게 낼 문제를 만들고 친구 문제를 해결한다.",
    summary: "내가 만든 문제를 친구와 코드로 주고받아요",
    mode: "playground",
    accent: "#16537e",
    emoji: "🎲",
  },
  {
    lesson: 10,
    title: "나만의 건축물 설계하기",
    goal: "쌓기나무로 건축물을 설계하고 층별로 나타낸다.",
    summary: "직접 설계하고 층별 모습을 정리해요",
    mode: "project",
    accent: "#8e7cc3",
    emoji: "🏛️",
  },
  {
    lesson: 11,
    title: "나만의 건축물 소개서",
    goal: "설계한 건축물을 위·앞·옆과 층별 모습으로 소개한다.",
    summary: "소개서를 완성해 친구들에게 보여 줘요",
    mode: "project",
    accent: "#c27ba0",
    emoji: "📔",
  },
  {
    lesson: 12,
    title: "단원 마무리",
    goal: "개수 구하기와 방향별 모양 표현을 종합해 해결한다.",
    summary: "배운 것을 모두 모아 도전해요",
    mode: "review",
    accent: "#444444",
    emoji: "🏁",
  },
];

export const LESSON_COUNT = LESSONS.length;

export function lessonDef(lesson: number): LessonDef | undefined {
  return LESSONS.find((l) => l.lesson === lesson);
}

export function lessonTitle(lesson: number): string {
  return lessonDef(lesson)?.title ?? `${lesson}차시`;
}
