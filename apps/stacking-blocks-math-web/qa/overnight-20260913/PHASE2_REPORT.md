# Phase 2 — VERIFIED_LOCAL / PASS

실행 시점: 2026-09-13 KST. 시작 HEAD: fcb1d28f37b92ecd61deb8680f5485b152beb4a5.
검사 대상은 시작 HEAD + 보존한 기존 미커밋 변경 + Phase 2 변경이다. 깨끗한 시작 HEAD의 검사로 해석하지 않는다.
최종 브라우저 source SHA256: 239c096753738198e5f31e035f3681f6a83cba21375a5bf50c46716ff0563a83
production build SHA256: 9be2701d9eb96a68f132e1a88f10829ae67fbb4f9801eba8c17e65ecf773b620

## 실제 구현

- `/student/lesson/1/redesign`: 개념 4활동(건축물 관찰, 세기 방법 예상, 실제 블록의 오른쪽/위 탭, 3층 관찰), 공통6+맞춤2, 연습5.
- `/student/lesson/2/redesign`: 개념 4활동(네 방향, 관찰자, 위치 지도, 카메라 찾기), 공통6+맞춤3, 연습5. 앞/뒤/왼쪽/오른쪽을 별도로 제공한다. 고정 사진도 실제 Babylon 모형이며 사진 자체의 회전은 금지한다.
- `/student/lesson/4/redesign`: 개념 5활동, 높이 지도↔3D 기둥 양방향 강조, 층 강조, 두 계산 방법 비교. 공통6+맞춤3, 연습5. 모든 생성 모형에 블록 수=높이 합=층별 개수 합 불변식을 적용한다.
- curriculum/problem/answer/grading/progress/display 계약과 기존 Babylon 엔진 재사용. 기존 LessonPage 복사 없음. readonly 모형의 명시적 inspectable 선택만 추가하며 편집은 허용하지 않는다.
- 현재 위치, 입력 중 답, 시도/완료, 맞춤 문제 배정을 설치·프로젝트URL·학급·학생·차시별 버전 namespace에 저장. 이번 경로는 LOCAL_ONLY이며 기존 운영 진도/작품을 수정하거나 Supabase 저장 완료로 표시하지 않는다.

## 실제 검사와 증거

- `phase1b/summary.json`: 기존 16건 모두 PASS. 이 단계 통과 후에만 Phase 2 구현 시작.
- `phase2/summary.json`: 최초 Phase 2 19건 PASS. 시각 검사에서 고정 사진의 잘못된 회전 안내를 발견해 해당 안내만 제거.
- `phase2-final/summary.json`: 그 변경 후 19건 PASS, FAIL/BLOCKED/NOT_RUN 0. production preview, Chromium 153, 원격 요청 차단, 실제 학생 route.
- P21/P22/P24: 각 Learn 전체→Solve 8/9/9→Practice 각5를 버튼·숫자·숫자지도·층격자로 실제 입력 후 채점. 3번째 문항에서 입력 중 새로고침, 같은 ID와 답 복원 확인. 1차시 실제 canvas 탭, 4차시 실제 기둥/지도 상호 선택.
- 기존 T01~T15+R16 재실행: 3차시 위/앞/오른쪽 옆, 독립 비대칭 기대값/실제 WebGL 화면, 격자 좌표·정사각형·입력·제출, 실제 마우스 배치/삭제/Undo/Redo, CDP touch, 6+4 전체 풀이, 4단계 오답, 단계 왕복·위치·초안·블록 복원, 연습5, 로그인 화면 및 기존 ProjectionGrid 회귀.
- 실제 캡처: `phase2-final/screenshots/lesson-1-position.png`, `lesson-2-camera.png`, `lesson-2-solve.png`, `lesson-4-columns.png`, `lesson-4-layers.png`, 각 `lesson-N-practice-complete.png`.
- 캡처 검토: 닫힌 원목 큐브, 판 기준 앞, 지도 아래 앞/오른쪽 옆, 셀 선택 강조, 동기화한 기둥/층, 큰 모형과 자료 나란히 배치 확인. 사진 영역의 불필요한 회전 안내는 최종 캡처에서 제거 확인. 도움말 접힘, 일부 페이지는 큰 터치 영역을 유지한 세로 스크롤이 남는다.

## 전체 검사

`checks/results.json`에 시점/종료코드, `checks/final-test-results.json`에 수정 후 재검사 기록.

- npm test 최초 80/81: 기존 테스트가 새로 구별하는 왼쪽/뒤를 free로 기대하여 1건 실패. 실제 좌표별 left/back 기대와 비정규 free 검사를 추가. 앱 코드 변경 없이 재실행 81/81 PASS.
- typecheck, lint, build, typecheck:edge, test:security PASS (보안 Deno 1/1).
- 테스트 수정 후 전체 unit/lint 재실행 PASS. 이 수정은 브라우저/앱 소스에 영향을 주지 않으므로 기존 실행한 최종19건을 그대로 해당 소스 증거로 유지한다.
- 생성 seed 표본: 0,1,2,123,314159,2147483647,4294967295. 표본 및 고정 fixture 검사를 전체 가능한 문항 의미의 증명으로 확대하지 않는다.

## 제한

LIVE_SUPABASE, 실제 iPad/Safari, 원격 저장·기기 간 복원 미검증. 인증 성공은 기존 로그인 화면 렌더링 회귀와 구분한다. 기존 수업 화면/간편 설치/5~8차시 구현 완료로 확대하지 않는다. 신규 기능은 redesign route에서만 제공한다.
