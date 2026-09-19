# Browser failure classification

Baseline: GitHub run 35442397755 (84fc59f), 5 PASS / 27 FAIL / 15 NOT_RUN. 실행 코드 변경 후 수치는 별도로 집계한다.

| Test | 분류 | 근거 | 수정 대상 |
|---|---|---|---|
| e2e/block-world.spec.ts:24 Babylon renders; mouse drag snaps, undo/redo and saved state restore | E | 학생 runtime config/solve stage 없는 fixture; 최신 명시적 합성 설정에서 실제 DOM 진입 확인 | 테스트 fixture. 후속 조작 실패는 아래 별도 기록 |
| e2e/block-world.spec.ts:48 touch pointer drag places a block without orbit conflict | E | 학생 runtime config/solve stage 없는 fixture; 최신 명시적 합성 설정에서 실제 DOM 진입 확인 | 테스트 fixture. 후속 조작 실패는 아래 별도 기록 |
| e2e/block-world.spec.ts:62 palette tap then board tap places a block | E | 학생 runtime config/solve stage 없는 fixture; 최신 명시적 합성 설정에서 실제 DOM 진입 확인 | 테스트 fixture. 후속 조작 실패는 아래 별도 기록 |
| e2e/block-world.spec.ts:73 free rotation changes the actual canvas and does not trigger saving | E | 학생 runtime config/solve stage 없는 fixture; 최신 명시적 합성 설정에서 실제 DOM 진입 확인 | 테스트 fixture. 후속 조작 실패는 아래 별도 기록 |
| e2e/block-world.spec.ts:84 failed server save retains local draft across reload then syncs | E | 학생 runtime config/solve stage 없는 fixture; 최신 명시적 합성 설정에서 실제 DOM 진입 확인 | 테스트 fixture. 후속 조작 실패는 아래 별도 기록 |
| e2e/block-world.spec.ts:96 lesson 5 restricts its initial camera and unlocks after answering and requesting information | E | 학생 runtime config/solve stage 없는 fixture; 최신 명시적 합성 설정에서 실제 DOM 진입 확인 | 테스트 fixture. 후속 조작 실패는 아래 별도 기록 |
| e2e/block-world.spec.ts:110 lesson 5 restriction also blocks touch orbit while other lessons remain free | E | 학생 runtime config/solve stage 없는 fixture; 최신 명시적 합성 설정에서 실제 DOM 진입 확인 | 테스트 fixture. 후속 조작 실패는 아래 별도 기록 |
| e2e/block-world.spec.ts:121 lesson 2 keeps camera orbit controls enabled | E | 학생 runtime config/solve stage 없는 fixture; 최신 명시적 합성 설정에서 실제 DOM 진입 확인 | 테스트 fixture. 후속 조작 실패는 아래 별도 기록 |
| e2e/redesign-phase2.spec.ts:34 P21 lesson1 learn four, solve eight, practice five actual flow | C + D | 라이브 suite에 병행 QA 경로 혼입; screenshot path의 SPATIAL_QA_OUTPUT 미설정 TypeError | 테스트 설정 분리 및 출력 경로 전달 |
| e2e/redesign-phase2.spec.ts:35 P22 lesson2 learn four directions, solve nine, practice five | C + D | 라이브 suite에 병행 QA 경로 혼입; screenshot path의 SPATIAL_QA_OUTPUT 미설정 TypeError | 테스트 설정 분리 및 출력 경로 전달 |
| e2e/redesign-phase2.spec.ts:36 P24 lesson4 synchronized heights/layers, solve nine, practice five | C + D | 라이브 suite에 병행 QA 경로 혼입; screenshot path의 SPATIAL_QA_OUTPUT 미설정 TypeError | 테스트 설정 분리 및 출력 경로 전달 |
| e2e/redesign-phase3.spec.ts:66 P35 L5 five Learn ten Solve five Practice with restore | C + D | 라이브 suite에 병행 QA 경로 혼입; screenshot path의 SPATIAL_QA_OUTPUT 미설정 TypeError | 테스트 설정 분리 및 출력 경로 전달 |
| e2e/redesign-phase3.spec.ts:67 P36 L6 five Learn ten Solve five Practice with restore | C + D | 라이브 suite에 병행 QA 경로 혼입; screenshot path의 SPATIAL_QA_OUTPUT 미설정 TypeError | 테스트 설정 분리 및 출력 경로 전달 |
| e2e/redesign-phase3.spec.ts:68 P37 L7 five Learn nine Solve five Practice with restore | C + D | 라이브 suite에 병행 QA 경로 혼입; screenshot path의 SPATIAL_QA_OUTPUT 미설정 TypeError | 테스트 설정 분리 및 출력 경로 전달 |
| e2e/redesign-phase3.spec.ts:69 P38 L8 five Learn nine Solve five Practice with restore | C + D | 라이브 suite에 병행 QA 경로 혼입; screenshot path의 SPATIAL_QA_OUTPUT 미설정 TypeError | 테스트 설정 분리 및 출력 경로 전달 |
| e2e/redesign-phase3.spec.ts:71 P40 alternative 3D answer, real example reveal and middle-layer restore | C + D | 라이브 suite에 병행 QA 경로 혼입; screenshot path의 SPATIAL_QA_OUTPUT 미설정 TypeError | 테스트 설정 분리 및 출력 경로 전달 |
| e2e/redesign-phase3.spec.ts:72 P41 mouse palette drag and tablet touch placement are real input | C + D | 라이브 suite에 병행 QA 경로 혼입; screenshot path의 SPATIAL_QA_OUTPUT 미설정 TypeError | 테스트 설정 분리 및 출력 경로 전달 |
| e2e/redesign-phase3.spec.ts:73 P42 optional practice middle layer has a unique answer and restores cells | C + D | 라이브 suite에 병행 QA 경로 혼입; screenshot path의 SPATIAL_QA_OUTPUT 미설정 TypeError | 테스트 설정 분리 및 출력 경로 전달 |
| e2e/redesign-phase3.spec.ts:75 P44 L5 both sufficient and insufficient information use judgment buttons | C + D | 라이브 suite에 병행 QA 경로 혼입; screenshot path의 SPATIAL_QA_OUTPUT 미설정 TypeError | 테스트 설정 분리 및 출력 경로 전달 |
| e2e/redesign-phase4.spec.ts:11 P46 L10 starts with a real 10×10 builder and saves project metadata | C + B/E/F | 저장 메시지 기대값이 실제 UI와 다름 | 별도 redesign suite; 후속 검사 필요 |
| e2e/redesign-phase4.spec.ts:22 P47 L11 reads the same saved project and exposes representations | C + B/E/F | 예전 비범위 저장 키로 작품 준비; 현재 설치/학급/학생 키와 불일치 | 별도 redesign suite; 후속 검사 필요 |
| e2e/redesign-phase4.spec.ts:32 P48 L12 common review supports count input and self evaluation without practice | C + B/E/F | 단계별 화면 전환 이전 제목/입력 기대값 | 별도 redesign suite; 후속 검사 필요 |
| e2e/redesign.spec.ts:55 T01 learn five distinct activities and concept summary | C + D | 라이브 suite에 병행 QA 경로 혼입; screenshot path의 SPATIAL_QA_OUTPUT 미설정 TypeError | 테스트 설정 분리 및 출력 경로 전달 |
| e2e/renderer-mount.spec.ts:36 projection problem mounts the triple grid renderer in the DOM | E | 학생 runtime config/solve stage 없는 fixture; 최신 명시적 합성 설정에서 실제 DOM 진입 확인 | 테스트 fixture. 후속 조작 실패는 아래 별도 기록 |
| e2e/renderer-mount.spec.ts:42 projection cells change the submitted payload on the real student route | E | 학생 runtime config/solve stage 없는 fixture; 최신 명시적 합성 설정에서 실제 DOM 진입 확인 | 테스트 fixture. 후속 조작 실패는 아래 별도 기록 |
| e2e/renderer-mount.spec.ts:74 a projection problem without evidence cannot submit or increase attempts | E | 학생 runtime config/solve stage 없는 fixture; 최신 명시적 합성 설정에서 실제 DOM 진입 확인 | 테스트 fixture. 후속 조작 실패는 아래 별도 기록 |
| e2e/renderer-mount.spec.ts:102 layer problem mounts one input grid per layer | E | 학생 runtime config/solve stage 없는 fixture; 최신 명시적 합성 설정에서 실제 DOM 진입 확인 | 테스트 fixture. 후속 조작 실패는 아래 별도 기록 |

## 새 live 실행에서 드러난 조작 오류 (80550ac)

- 마우스/터치: 보관함이 viewport 밖인데 boundingBox 좌표로 직접 pointer 시작. scrollIntoView 후 조작하도록 수정.
- 탭: 사선 시점 canvas 중앙이 바닥 위가 아님. 실제 위 시점의 바닥으로 조작.
- 오프라인: status 선택자가 카메라 output까지 2개를 가리킴. 저장 상태로 범위 지정.
- 격자: 화면 첫 행은 수학 좌표 마지막 행. payload [1][0] 검증으로 수정; [0][0]로 좌표계 변경하지 않음.
- P0: aria-hidden 장식 번호 05를 accessible name에 기대한 잘못된 선택자.
- L9: 합성 SQL adapter가 숫자 포함 RPC 이름 v2를 거부함. 실제 handler+PostgreSQL 단위 회귀 추가.
- L11: 소개서에는 편집 입력칸이 없음. 새로고침 후 동일 제목/서버 작품 row 검증.

## 실제 앱 수정

- 9차시 Learn 시작 버튼이 일반 solve 경로로 연결되던 오류 수정.
- 라이브 활동 API 기본 문제 목록 누락 보완.
- 기존 SQL 첫 완료 INSERT의 score 누락 및 hint/완료 동시 요청 원자성 보완 (새 additive migration).
- 공개 힌트 조건을 채점에 포함.

분리는 삭제/skip/PASS 처리가 아니다. redesign 미재실행 사례와 기존 15 NOT_RUN은 계속 미검증이다. 실제 iPad/Safari 검사는 수행하지 않았다.
