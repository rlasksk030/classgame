# Phase 1B — PASS

최종 단일 실행: **계획 16 / 실행 16 / PASS 16 / FAIL 0 / BLOCKED 0 / NOT_RUN 0**.
T01~T15 필수 검사 + R16 기존 화면 회귀검사. UI_WITH_TEST_DATA / LOCAL_ONLY.

실행 UTC: 2026-09-12T16:15:03.288Z. 소요 86.6초. 시작 HEAD: `5b43a2504085443235afed4c55ba0064ea043150` + 보존한 기존 미커밋 변경 + Phase 1B 수정. 깨끗한 HEAD 단독으로 검사했다는 뜻이 아니다. 이 보고서를 포함하는 별도 커밋에는 Phase 1B 변경만 넣으며 기존 변경은 남긴다.

production dist SHA256: `9021a0c7d760e7e518ab4f73928d63984b55d12ee78dd5df24c449cf319c2541`.
최종 `gate-confirmation/identity.json`에는 실행 소스·검사·build 해시를 기록했다. `verified-final`에서 만든 dist를 그대로 사용했고 이후에는 검사 초기 대기와 중복 trace 처리만 수정했다.

## 서버 실패 원인

최초 `npm run qa:redesign` 1회: build 성공, preview가 `listen EPERM 127.0.0.1:4186`으로 즉시 종료했다. timeout이 아니며 당시 listener 없음. Playwright 밖 동일 명령도 같은 오류. 도구 승인된 로컬 실행에서 **동일 host/port/command**로 정상 시작했고 `/`, `/?class=TEST`, `/student/lesson/3/redesign`, `/teacher`가 HTTP 200이었다.

확정 원인: sandbox localhost 바인딩 권한. build 누락, port 충돌, IPv4/IPv6 혼선, 잘못된 Vite 옵션, browser 미설치, Supabase env, cwd, health URL 문제가 아니다. 임의 port 변경, dev server 대체, 새 패키지 설치, 다른 프로세스 종료 없음.

실제 실행 연결:
`package.json → scripts/run-redesign-qa.mjs → npm run build → playwright.redesign.config.ts → node scripts/redesign-preview.mjs → node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4186 --strictPort`.

BUILD_VERIFIED: production build PASS. B| T01 | PASS | Learn 1→5 실제 활동 및 완료 조건 |
| T02 | PASS | 세 정규 시점: 관찰 위치+실제 WebGL 픽셀 |
| T03 | PASS | 비대칭 오른쪽 높이 2·1·3과 참고 그림 |
| T04 | PASS | 위 격자 아래=앞(-Z), 클릭 역변환 |
| T05 | PASS | 셀 중앙·가장자리 입력→제출→실제 채점 |
| T06 | PASS | 3개 viewport 정사각형 셀 오차≤1px |
| T07 | PASS | 마우스 drag→배치→삭제→Undo/Redo→reload |
| T08 | PASS | 합성 touch drag→실제 canvas 배치 |
| T09 | PASS | 공통 6+맞춤 4 실제 풀이→완료→연습 진입 |
| T10 | PASS | Solve 5번 reload 및 단계 왕복 유지 |
| T11 | PASS | 미제출 격자 답안 reload 복원 |
| T12 | PASS | 4단계 오답 피드백→정답/내 답 비교→수정 |
| T13 | PASS | 연습 5문제 실제 완료→6/10 추가 문제 |
| T14 | PASS | 기존 학생 로그인 UI route |
| T15 | PASS | 기존 교사 로그인 UI route |
| R16 | PASS | 기존 실제 route ProjectionGrid 순서·방향·제출 좌표 |ER_QA_SERVER: 위 production preview. 마지막 전체 확인은 같은 dist에서 기존 Playwright를 실행했다. runner 종료 0 및 4186 listener 없음 확인. 별도 ps 조회는 sandbox에서 거부되어 프로세스 표 확인으로 주장하지 않는다(`cleanup.json`).

## 환경

macOS / Node 24.14.1 / npm 11.11.0 / Playwright 1.63.0 / Chromium 153.0.8010.12.
1366×768 기본, 1024×768·768×768 격자 측정, 1024×768 CDP 합성 터치. Babylon 실제 WebGL/SwiftShader 렌더링. 실제 iPad/Safari 검증과 다르다.

## 실제 브라우저 결과

| ID | 결과 | 확인 내용 |
|---|---|---|
| T01 | PASS | Learn 1→5 실제 활동 및 완료 조건 |
| T02 | PASS | 세 정규 시점: 관찰 위치+실제 WebGL 픽셀 |
| T03 | PASS | 비대칭 오른쪽 높이 2·1·3과 참고 그림 |
| T04 | PASS | 위 격자 아래=앞(-Z), 클릭 역변환 |
| T05 | PASS | 셀 중앙·가장자리 입력→제출→실제 채점 |
| T06 | PASS | 3개 viewport 정사각형 셀 오차≤1px |
| T07 | PASS | 마우스 drag→배치→삭제→Undo/Redo→reload |
| T08 | PASS | 합성 touch drag→실제 canvas 배치 |
| T09 | PASS | 공통 6+맞춤 4 실제 풀이→완료→연습 진입 |
| T10 | PASS | Solve 5번 reload 및 단계 왕복 유지 |
| T11 | PASS | 미제출 격자 답안 reload 복원 |
| T12 | PASS | 4단계 오답 피드백→정답/내 답 비교→수정 |
| T13 | PASS | 연습 5문제 실제 완료→6/10 추가 문제 |
| T14 | PASS | 기존 학생 로그인 UI route |
| T15 | PASS | 기존 교사 로그인 UI route |
| R16 | PASS | 기존 실제 route ProjectionGrid 순서·방향·제출 좌표 |

새 실제 학생 route `/student/lesson/3/redesign`에서 client grader와 로컬 저장을 사용했다. 무조건 정답 반환 mock은 없다. R16만 기존 `/lesson/3/solve`의 API를 합성 응답으로 처리했고, 부분 답안 payload를 검증한 뒤 오답 응답을 반환했다. 모든 운영 요청은 차단/합성 처리한다.

## 실패에서 확인한 수정

- APP: 실제 +X 카메라의 오른쪽 높이는 2·1·3인데 참고 그림은 3·1·2였다. 최초 약한 15/15 이후 PNG에서 발견하고, 강화한 T03의 실제 canvas 픽셀+독립 고정값 검사로 FAIL을 먼저 재현했다. **새 redesign 전용 표시/입력 역변환**으로 수정. 기존 저장 side 좌표·채점·학생 기록은 그대로다.
- APP/UI: 고정 canvas-bottom '앞'을 실제 앞(-Z) 모서리의 world 좌표에 연결. 바깥쪽 화살표는 실제 앞 모서리 선으로 교체.
- APP/UI: 최고층 잘림을 home/free framing으로 수정. 바닥 picking plane이 tile보다 위여서 격자 틈을 덮던 문제를 수정. canonical orthographic scale·정수좌표·물리 규칙 유지.
- APP/UI: 두 모형 및 정답/내 답 비교를 넓은 화면에서 나란히 배치. 과도한 제목 여백만 줄이고 48px 셀·46px 버튼 유지.
- TEST: 실제 legacy 입력 enum `GRID` 사용. T13의 중복 h2 selector를 실제 6/10 문제 제목으로 한정. T01/T09 긴 전체 흐름만 180초 상한, 첫 lazy/WebGL 화면만 15초 상한, 다른 assertion 5초 유지. 중복 수동 tracing 제거. skip·강제 클릭·채점 완화 없음.
- QA: PID/명령/exit/stdout/stderr, source/build 해시, 덮어쓰지 않는 결과 폴더. 자동 trace 영상만 끄고 명시 PNG 및 DOM/action trace 유지. 생성된 Playwright HTML vendor 코드만 lint 제외.

실패 이력 보존: `right-side-reproduction/` 방향 FAIL, `final-run/` 14/16, `verified-final/` 13/16(초기 대기/중복 trace), `focused-confirmation/` 수정한 3/3, **`gate-confirmation/` 최종 단일 16/16**. 이전 PASS를 현재 결과로 재사용하지 않았다.

## 방향·UI·Persistence

front=-Z / right side=+X / top=+Y. 실제 세 방향 이미지와 독립 기대 격자 일치. 위 격자 아래=앞, 오른쪽=옆. 새 adapter만 적용했으며 legacy 재해석·재채점 없음.

대표 PNG를 직접 열어 검토했다. 실제 블록/팔레트는 닫힌 큐브, 셀은 정사각형, 선택 표시 명확, '앞'은 실제 모서리에 위치한다. 두 3D 및 자료/입력은 나란히 보인다. 활동 5·피드백·완료 화면에는 세로 스크롤이 남는다(1366×768에서 full-page 높이 약 874~1294px). 내용을 숨기거나 글자·터치 영역을 줄이지 않았다. 모든 내용을 한 화면에 표시한다는 주장은 하지 않는다.

실제 reload로 활동 5 및 8개 블록, Solve 5번, 미제출 격자 답을 복원했다. 단계 왕복·10문제 연속 제출·연습 완료 후 추가 진입 PASS. 저장은 설치/학생/학급/버전별 **현재 기기 한정**이다. 서버 및 다른 기기 동기화는 미검증.

## 기타 검사와 범위

`checks/results.json`에 실행 시각·종료코드 기록: typecheck, lint, unit 76개, security, typecheck:edge PASS. 최종 검사 파일의 별도 TypeScript/lint도 PASS. production build PASS (`verified-final/build.stdout.log`).

운영 Auth/Supabase, 물리 iPad/Safari, 교차 기기 저장은 미검증. 로그인 두 회귀는 UI 렌더링만 확인했다. 전체 앱/설치 완료가 아니며 기존 P0·INSTALL_EASY 백로그 유지.

## 증거 위치

- 요구 PNG: `screenshots/`, 원본 경로·해시 `screenshots/manifest.json`.
- 최종 trace와 case 화면: `gate-confirmation/evidence/`.
- 최종 원시 결과: `gate-confirmation/report.json`, `summary.json`, `stdout.log`.
- 재현/수동 시작: `reproduction.json`, `qa-redesign.*.log`, `webserver.*.log`, `manual-server.json`, `permitted-manual-server.json`.
- 원인/환경: `diagnosis.md`, `environment.txt`.

**READY_FOR_PHASE_2** — 이 로컬 브라우저 게이트에 한정한다. 이번에는 다음 차시 구현으로 넘어가지 않는다.

push NO / deploy NO / remote migration NO / 운영 데이터 변경 NO.
