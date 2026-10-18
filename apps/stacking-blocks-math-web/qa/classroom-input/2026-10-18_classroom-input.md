# 2026-10-18 교사 신고: 개념 복습 및 태블릿 입력

## 범위와 기준

- 운영 기준 `d84980fb1069a017151960ac6c46203a1b09222e`에서 별도 수정 branch 시작.
- 최초 commit `93edf64`: 수정 전에 실패 재현 테스트 3개 추가. 모두 실패 확인.
- 신고 학급의 링크와 기기 정보를 사용자가 알 수 없다고 답변했다. 해당 학생의 실제 완료 기록, Android/iPad/학교 태블릿 실물 검증은 **NOT_VERIFIED**다. 다른 학급을 신고 학급의 증거로 대체하지 않는다.
- 운영 학생/교사 인증, DB, migration, Edge, RLS, 설치 시스템은 수정하지 않는다. 모든 개발 검증은 외부 API 요청을 차단한 합성 학생으로 수행한다.

## A. 원인과 수정

`LessonPage.moveToStage('concept') → navigateSaved → /learn`이 명시적인 복습과 월드 기본 진입을 구별하지 않았다. `LessonLearnPage`는 항상 `stageRedirectPath(currentStage)`를 적용하여 required는 /solve, optional/completed는 /practice로 돌려보냈다. ③ → ① → ③을 운영 기준 코드에서 재현했다.

서버는 `guided_completed`와 현재 학급/global 활성 check 문항의 `sb_problem_attempts.completed`로 currentStage/requiredComplete를 계산한다. guided_completed는 탐구 방문 자체가 아니라 solve/practice 진입 때 true가 되는 기록이다. 따라서 과거 기록상 guided+필수가 완료된 학생만 기본 진입에서 ③으로 이동할 수 있다. 신고 학생이 이 조건에 해당했는지는 실제 프로젝트/학생 식별 정보가 없어 확인하지 못했다. 신규 학생이 무조건 ③으로 이동한다고 판단하지 않는다.

- 명시적 ①은 `/learn?review=1`: 서버 이어하기 redirect만 생략. 새로고침 후에도 복습 유지.
- 기본 `/learn`은 기존 서버 이어하기 유지.
- 탐구 조작은 원래부터 컴포넌트 내부 상태만 변경한다. 복습에서 진도 위치·답안·채점 요청을 보내지 않는다.
- 개념 문제는 `?review=concept`으로 별도 읽기 전용 열람. 저장/채점/초기화/재구성/답안 초안 갱신을 차단하고 원래 이어하기 위치를 보존한다.
- 탐구 화면의 ③도 requiredComplete로 잠근다. `/practice` 직접 진입 시 기존 필수 미완료 차단을 유지한다.
- 이미 완료한 쌓기 문제의 도구 초기화/재구성도 잠가 보존 조건과 일치시킨다.

## B. 재현된 입력 결함과 수정

- 기존 5 CSS px 기준은 터치의 작은 흔들림(테스트 8 px)을 drag로 판정했다. 보관함 내부에서 손을 뗀 경우 다음 작업판 터치를 기다리는 상태가 되지 않아 두 번 터치가 실패했다.
- pointerup이 마지막 pointermove와 다른 위치에서 오면, 작업판 밖에서도 이전 후보 위치에 놓였다. 실제 브라우저 입력으로 재현했다.
- 기존 pointer capture 없음, cancel/blur 시 남는 armed 상태, 블록 선택을 즉시 이동으로 취급하는 상태도 함께 정리했다.
- mouse 5 px/터치·펜 14 px 허용, 명시적 pointer capture와 해제, 취소/포커스 상실 처리, 손을 뗀 최종 위치 재검사.
- 보관함 두 번 터치와 명확한 ‘터치로 놓기’ 버튼 제공. ‘버튼으로 놓기 → 가로·세로 → 쌓기’ 유지. 터치 버튼 최소 48 px, 초등학생용 첫 사용 안내.
- 관찰 전용·완료 문제는 편집 제한 유지. 직접 쌓는 문제만 블록 도구 제공. 카메라 조작과 배치는 분리.
- 이 결함들이 신고 기기에서 실제로 발생한 모든 원인이라고 단정하지 않는다. 기기 모델/OS/브라우저 정보는 없음.

## 검증 기록

- 수정 전: ③→① 실패 / 8 px 터치 흔들림 후 두 번 터치 실패 / 판 밖 release 오배치, **3/3 실패 재현**.
- 수정 후 관련 기존 블록 검사 8 + 재현 검사 3: **11/11 PASS**.
- 확장 회귀: 신규/부분 완료 이어하기, ①→②→③, 필수 미완료 차단, 개념 읽기 전용, 터치 두 번 2층/선택/이동/삭제/저장·reload, 취소, 관찰·완료 제한 등 **9/9 PASS (Chromium 합성 데이터)**.
- 전체 unit: **795/795 PASS**, 기존 보안 검사 **1/1 PASS**, Edge typecheck/seed/typecheck/lint/build PASS.
- 첫 unit 실행의 loopback listen EPERM은 sandbox 제약으로 구분하고, 허용된 로컬 실행에서 전체를 재실행했다.
- WebKit, 전체 E2E, GitHub CI, LIVE 검증은 아래 최종 증거에 추가한다. 확인 전 PASS로 기록하지 않는다.

## 수정 파일

`LessonLearnPage.tsx`, `LessonPage.tsx`, `BlockWorld.tsx`, `BlockScene.ts`, `index.css` 및 회귀 테스트/검증 설정만 변경한다. shared/DB/Edge/인증/설치 코드 변경 없음.

## 보존 및 배포

배포 직전 정상 Render LIVE: `dep-db4p2inavr4c73eemcpg`, SHA `d84980fb1069a017151960ac6c46203a1b09222e`.
실제 학생 데이터 직접 쓰기·삭제 0. DB/Edge 배포 0. 코드의 진도 변경/보상 지급 계약은 유지한다.
기존 GitHub Actions 두 workflow 성공 후에만 release/production 병합 및 Render 자동 배포한다.
운영 UI 핵심 smoke 실패 시 신규 배포를 성공으로 보고하지 않고 직전 정상 Frontend 복구를 검토한다.
