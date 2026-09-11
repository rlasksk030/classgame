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
| Unit | PASS — 35개 |
| Security | PASS — PIN hash 범위 및 session 위변조 검사 |
| TypeScript / ESLint | PASS |
| Edge Function typecheck | PASS |
| Production build | PASS |
| Practice current-position persistence | PASS — `last_problem_id` hydration and explicit position updates; reset-on-stage effect removed; unit coverage added |
| Wide learning workspace | PASS — fluid 1600px desktop frame and horizontal multi-grid layout |
| Architecture workspace | PASS — new projects use 8×8×3; persisted grid metadata keeps legacy records readable |
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
| 10 | 8×8×3 건축 설계 화면 |
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
