# 자동 QA 보고서

현재 코드 기준 자동 점검 결과입니다. 이 보고서는 실제 Supabase 운영 데이터나 실제 iPad Safari 실행을 대신하지 않습니다.

## Core quality gate

| 항목 | 결과 |
|---|---|
| 문제 좌표·정답 감사 | PASS — 기본 30개 + 생성 5,600개, invalid 0 |
| Presentation 감사 | PASS — 기본/생성 14,030개, 누락 0 |
| Semantic QA | PASS — 2,830개 문구·답안 계약 |
| Solvability QA | PASS — 2,830개 유효 구조·정답 존재 |
| Curriculum QA | PASS — 1~12차시 route·단계·Renderer 계약 |
| Renderer DOM mount | TEST READY — 3방향/층별 입력 검증 스위트는 로컬 포트 제한으로 미실행 |
| Unit | PASS — 45개 |
| Security | PASS — PIN hash 범위 및 session 위변조 검사 |
| TypeScript / ESLint | PASS |
| Edge Function typecheck | PASS |
| Production build | PASS |
| Practice current-position persistence | PASS — `last_problem_id` hydration and explicit position updates; reset-on-stage effect removed; unit coverage added |
| Wide learning workspace | PASS — fluid 1600px desktop frame and horizontal multi-grid layout |
| Architecture workspace | VERIFIED_LOCAL — new projects use 10×10×3; persisted grid metadata keeps legacy records readable |
| Front marker / palette theme | PASS — front edge label clarified; palette cube uses the neutral wood token colors |

## 차시별 점검

| 차시 | 자동 확인 |
|---|---|
| 1 | 위치·층·개수 문제와 답안 Renderer |
| 2 | 방향 투영과 모호한 방향 0건 |
| 3 | 실제 투영 크기 격자와 셀 입력 |
| 4 | 높이 지도·층별 자료 표시 계약 |
| 5 | 제한 카메라 정책과 추가 정보 단계 |
| 6 | 위·앞·옆 조건과 constraint 채점 |
| 7 | 높이 지도 입력/생성 |
| 8 | 층별 지도 입력/생성 |
| 9 | 10개 Builder, 문제·힌트 카드, 미리보기 |
| 10 | 10×10×3 신규 건축 설계 화면 |
| 11 | 소개서 편집·미리보기 화면 및 Builder 보조 진입 |
| 12 | 종합 문제와 투영 격자 |

## 실제 브라우저 확인이 필요한 항목

- 실제 Mac Chromium에서 로그인 후 대표 화면의 문구와 시각적 균형
- Chromebook/WhaleBook과 iPadOS Safari의 터치 drag, tap-to-place, pinch, orientation 변경
- 실제 Supabase Auth/RLS/Edge Function 관통 흐름
- QR 코드 생성은 아직 구현하지 않았고 현재는 링크 복사 방식
- `npm run qa:visual` 실행 결과: Playwright webServer가 샌드박스의 `listen EPERM: 127.0.0.1:4173`로 시작하지 않아 캡처 미생성
- `npm run qa:renderer`도 같은 로컬 포트 바인딩 제한으로 실행하지 못했다. 테스트 코드는 준비되어 있어 권한 있는 개발 환경에서 실제 DOM mount를 확인한다.
- 자동 캡처 스위트는 `npm run qa:visual`로 실행하며 성공 시 `qa/screenshots/`에 1366×768 및 1024×768 터치 캡처를 저장한다.
- Renderer DOM mount 스위트는 `npm run qa:renderer`로 실행한다. API를 모의해 3방향 격자 3개와 층별 격자를 실제 DOM에서 확인한다.

## 자동 QA 오류 카운터

| 코드 | 결과 |
|---|---:|
| UNSOLVABLE_PROBLEM | 0 |
| QUESTION_INTENT_MISMATCH | 0 |
| WRONG_ANSWER_INPUT | 0 |
| MISSING_REQUIRED_EVIDENCE | 0 |
| MISSING_RENDERER | 0 |
| ANSWER_REVEAL_NOT_VISIBLE | 0 |
| GRADER_MISMATCH | 0 |
| PROGRESS_RESET | 0 (단위/코드 감사) |
| FRONT_DIRECTION_MISMATCH | 0 |
| LAYOUT_OVERFLOW | 0 (CSS 계약; 실제 기기 확인 필요) |

재실행 명령:

```bash
npm run qa:curriculum
npm run audit:lessons
npm run audit:problems
npm run audit:presentation
npm run audit:semantics
npm run audit:solvability
npm test
npm run test:security
npm run typecheck
npm run lint
npm run typecheck:edge
npm run build
npm run qa:visual
npm run qa:renderer
npm run test:e2e
```

## XP 보상 공방 QA (2026-09-12)
- 보상 카탈로그: 원목 0 XP, 파스텔 50 XP, 벽돌 150 XP, 타일 300 XP; 설계 도면 0 XP, 전시관 250 XP, 하늘 정원 450 XP.
- 실제 사용 경로: `/world/rewards`에서 해금·미리보기·사용하기 → 10차시 블록 재료 → 11차시 소개서 테마. 프로젝트 저장 RPC가 외형 metadata와 테마를 보존한다.
- 좌표 채점과 외형을 분리하고 순수 함수/단위 테스트를 통과시켰다. 원격 migration 적용과 실제 브라우저/Supabase 관통 검증은 이번 변경에서 수행하지 않았다.

## 오른쪽 관찰 기준 표시 QA (2026-09-12)
- 학생의 투영 답안과 문제 제시 자료에서 옆 방향 제목이 `옆에서 본 모양(오른쪽)`으로 표시된다.
- 차시 화면에 `옆`이 오른쪽 관찰 기준임을 안내하는 문구를 표시한다.
- 계산·채점 규칙은 기존 `side[y][depth-1-z]` 오른쪽 기준을 유지한다.
- 바닥 지도(위·높이·층별·답안)에 `앞에서 바라봄`과 `오른쪽(옆)에서 바라봄` 표식을 추가하고, 앞·옆 실루엣에는 해당 표식을 복사하지 않는다.
- 교사 학생 기록과 활동 기록은 저장된 작품 grid metadata를 사용해 신규 10×10과 기존 크기 작품을 구분해 렌더링한다.
- DOM/시각적 브라우저 캡처는 이 환경의 `listen EPERM: 127.0.0.1:4173`로 BLOCKED이며, 로컬 자동 검사와 빌드만 현재 커밋에서 재실행했다.

## 학생 화면 긴급 오류 QA (2026-09-12)

| 요구 ID | 실제 원인 | 수정 파일 | 재현 테스트 | 화면 증거 | 상태 |
|---|---|---|---|---|---|
| R01 | 구버전/부분 투영 응답에서 답안 격자 면을 렌더러가 알 수 없었음 | `src/pages/LessonPage.tsx`, `shared/problemPresentation.ts`, `tests/problemPresentation.test.ts` | 3차시 단일·세 방향 Renderer 계약, 41개 회귀 | Playwright 포트 제한 | IMPLEMENTED (브라우저 BLOCKED) |
| R02 | 5차시 숫자 문항이 원본 블록 총개수를 정답으로 사용하고 정보 충분성 문항과 섞였음 | `shared/seedProblems.ts`, `shared/practiceGenerator.ts`, `tests/activities.test.ts` | 정보 충분성 CHOICE와 숨은 블록 없음 COUNT의 독립 정답 | Playwright 포트 제한 | VERIFIED_LOCAL |
| R03 | 정답 공개 후 모든 유형에 재구성 문구가 공통 적용됨 | `shared/attempts.ts`, `supabase/functions/student-api/index.ts`, `src/pages/LessonPage.tsx`, `tests/blocks.test.ts` | 비쌓기 유형 `requiresRebuild=false` 상태 기계 | Playwright 포트 제한 | VERIFIED_LOCAL |
| R04 | 앞 방향 UI가 긴 경계 문구로 표시됨 | `src/components/world/BlockWorld.tsx`, `src/components/world/ProjectionGrid.tsx`, `src/pages/LessonPage.tsx` | 라벨 소스 검색·TypeScript 회귀 | Playwright 포트 제한 | IMPLEMENTED (브라우저 BLOCKED) |
| R05 | CSS 보관함 아이콘이 분리된 면처럼 보여 닫힌 큐브가 아니었음 | `src/components/world/BlockWorld.tsx`, `src/styles/index.css` | SVG 세 면 공통 꼭짓점과 기존 배치 경로 유지 | Playwright 포트 제한 | IMPLEMENTED (브라우저 BLOCKED) |
| R06 | 학생 route가 `all` 단계로 섞여 표시되고 이전 명칭을 사용함 | `src/pages/LessonPage.tsx`, `src/pages/StudentWorld.tsx` | 단계별 문항 인덱스·복원 회귀, 41개 회귀 | Playwright 포트 제한 | IMPLEMENTED (브라우저 BLOCKED) |

### 실행 증거

- 현재 변경 작업 트리에서 `npm run audit:problems` 5,600개, `audit:presentation` 14,030개, `audit:semantics` 2,830개, `audit:solvability` 2,830개가 통과했다.
- `npm test` 41개, `npm run test:security`, `npm run typecheck`, `npm run lint`, `npm run typecheck:edge`, `npm run build`가 모두 통과했다.
- 실제 DOM mount와 화면 조작은 `npm run qa:renderer`, `npm run qa:visual`, `npm run test:e2e`가 이 환경의 포트 권한 오류로 실행되지 않아 BLOCKED다. 스크린샷은 생성되지 않았다.

## 전체 문항 inventory (2026-09-12)

`npm run inventory:problems`가 현재 코드 경로에서 고정 문항 30개, practice template 대표 56개, 9~12차시 활동 6개, 수업용 practice manifest 140개를 수집해 `PROBLEM_INVENTORY.json`으로 기록한다. template 반복 생성 수와 실제 문항 유형 수를 분리 집계하며, 원격 Supabase 문항을 읽지 못한 범위는 LIVE 검증으로 올리지 않는다.

현재 inventory의 화면 상태는 코드 경로 기준 `IMPLEMENTED`이고, 실제 학생 입력·채점·렌더링은 Playwright 포트 제한으로 `BLOCKED`다.
