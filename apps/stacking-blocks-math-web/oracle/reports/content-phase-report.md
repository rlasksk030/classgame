# Problem Bank & Content QA

Result: PARTIAL. 콘텐츠 생성·수학·채점 게이트는 PASS. 기존 브라우저 CI는 FAIL이며, 9차시 시스템 은행의 실제 화면/API 연결은 다음 Phase 대상이다.

## 실행 기준과 보존

- 시작: `aed25733e1a18c12de034c7f7127a68d587f208a`, `feature/spatial-math-redesign-v1`.
- fetch 후 시작 local/remote 차이 0/0. main/운영/설치 시스템은 변경하지 않았다.
- 콘텐츠·QA 코드 검증: `84fc59fa339bf25f165eb4a7152f8d7b8002361f`.
- 이후 변경은 oracle 보고서의 버전별 seed 수 표기 보정과 결과 문서뿐이다. 표기 보정 후 `oracle:verify`를 다시 실행했다(2026-09-19T12:20:40Z).
- 기존 미추적 `qa/overnight-20260913/{phase1b/html,phase2-final/html,phase2,preserved.diff}` 및 `qa/redesign-phase5/`를 그대로 보존하고 commit에 넣지 않았다.
- 기존 v1/v2 생성 경로와 저장 문항은 유지한다. 새 v3 코드와 ID는 기존 문항을 덮어쓰지 않는다. 실제 DB의 고정 문항/시도/진도는 수정하지 않았다.

## 수정과 확장

| 대상 | 실제 변경 |
|---|---|
| L6-03 | L6-01의 복제 대신 세 방향 조건의 최소 개수 추론 |
| L12-04 | 높이 지도에서 오른쪽 옆 투영으로 변환 |
| L12-05 | 층별 자료에서 높이 지도로 변환 |
| L12-06 | 세 방향 자료의 개수 확정성 판단 |
| L6 min/max | 수치 입력·정답 계약. 앱 solver 결과를 별도의 DFS 극값과 비교 |
| 선택지 | seed 기반 shuffle에 정답 index도 함께 이동. 저장된 구버전은 재배열하지 않음 |
| 복원 | v3 세트를 구버전 오류 세트로 잘못 판정하지 않도록 버전 판별 보완 |

5차시 8계열: 앞모습 정보 충분성 / 숨은 블록 없음 가정 / 최대 개수 / 완전한 높이 지도 추가 후 개수 / 세 방향 정보 충분성 / 회전·층 공개 후 개수 / 최소 개수 / 높이 지도로 제시한 반례의 개수.

6차시 8계열: 세 방향에서 쌓기 / 다른 유효 모형 탐색 / 후보 높이 지도 판별 / 최소 개수 / 최대 개수 / 모양 유일성 판단 / 높이 조건 추가 후 정확 복원 / 불가능한 전체 개수 선택. 복수해가 실제 존재할 때만 여러 모양이 가능하다고 안내한다.

12차시 8계열: 높이→오른쪽 옆 / 높이→세 투영 / 층별→개수 / 층별→높이 / 높이→층별 / 세 방향에서 쌓기 / 최대 개수 / 정보 충분성. redesign의 별도 공통6+맞춤4 생성 경로를 이번에 바꾸지는 않았다.

9차시: seed `20260919`에서 24개의 서로 다른 공개 투영 카드를 생성. 정확히 10개, 3×3 범위, 지지 조건, 투영·높이/층 힌트 일치 및 독립 DFS 존재성 검사. 생성 시도 상한 2,000이며 부족하면 실패한다. 시스템 기본 예제의 높이는 3층까지로 생성하지만 학생 제작판의 기존 높이 계약을 제한하지 않는다.

`shared/contentBank.ts`의 신규 추론 문항은 유한한 2×2 또는 3×2, 높이3 범위에서 생성→조건 계산→독립 oracle→난이도 분류를 통과해야 반환한다. 판 크기를 일반 UI/학생 작품에 적용하는 변경은 없다. 탐색 중간 결과로 극값·유일성을 확정하지 않는다.

## 독립성과 품질 판정

- oracle geometry/DFS는 앱의 blocks/grading 계산을 import하지 않는다. 기존 grader는 oracle로 검증된 답을 받는 검사 대상으로만 사용한다.
- 신규 v3 fingerprint는 ID·seed·번호·문구·보기 순서·비공개 원본을 제외하고 실제 공개 자료·가정·추론 과제·입력 방식·범위를 비교한다.
- fixed duplicate 게이트는 동일 구조 재발을 검사한다. 모든 자연어 의미적 유사성을 완전히 판별한다는 주장은 하지 않는다.
- `oracle:known-issues`는 경고만 남기지 않고 중복·oracle 실패·도달하지 못한 template·min/max 계약 불일치·과도한 연속·선택지 위치 편중에 비정상 종료한다.
- 난이도는 문제 번호가 아니라 기본 관찰/변환/제약 역추론/최소최대 판단에 따라 분류한다. 학생 대상 난이도 실측은 아니다.

## 실행 결과

실행일: 2026-09-19 UTC (한국 시각으로 2026-09-19~20). 대상 코드: `84fc59f`, 위 보고서 표기 수정 제외 앱/콘텐츠 코드 동일.

| 검사 | 결과 |
|---|---|
| npm test (로컬) | 252 중 PASS 250, FAIL 0, SKIP 2 |
| 신규 콘텐츠 회귀 | 고정 복제·가짜 min/max를 수정 전 FAIL로 재현. 정답 shuffle, 의미 중복, oracle 거부, 24개 peer bank, v3 복원 포함 12개 PASS |
| oracle:verify | 고정30 + 생성13,920 = 13,950, mismatch0 |
| oracle:known-issues | 신규 v3 7,200 + peer24, 실패0 |
| audit:problems | 고정30 + 생성6,000 PASS |
| audit:presentation | 14,030 PASS (DOM/브라우저 검사가 아님) |
| audit:semantics / audit:solvability | 각 2,830 PASS |
| audit:lessons | 12차시 계약/등록 검사 PASS (브라우저 검사가 아님) |
| typecheck / lint | 최신 코드 GitHub Actions에서 각각 PASS |
| Edge typecheck / security / build | 같은 Actions 실행에서 각각 PASS |

로컬 전체 typecheck/lint는 node_modules 파일 읽기에서 장시간 정체되어 해당 작업만 종료했다. 이를 PASS로 계산하지 않았다. 변경 모듈 대상 TypeScript 및 Deno 검사는 PASS. 전체 타입·린트 결과의 근거는 [84fc59f 기존 CI](https://github.com/rlasksk030/classgame/actions/runs/35442397755)다.

SKIP 2건은 기존 installer HTTP 통합 검사(로컬 listen 제한)이며 PASS에 포함하지 않았다. 설치 코드는 수정하지 않았다.

### 표본과 DFS 한계

| 버전 | seed 범위(각 차시) | 문항 | DFS | 탐색 한도 도달 |
|---|---|---:|---:|---:|
| v1 | 0~59 | 3,360 | 480 | 480 |
| v2 | 0~59 | 3,360 | 420 | 413 |
| v3 | 0~119 | 7,200 | 1,680 | 0 |
| 고정 | 전수 | 30 | 6 | 1 |
| 합계 | | 13,950 | 2,586 | 894 |

구버전/고정의 한도 도달 894건은 완전 탐색 증명이 아니다. 신규 v3 극값·유일성 검사에는 한도 도달이 없다. mismatch0은 실행한 검사 결과이며 무한 seed 공간이나 실제 화면의 완전성을 보증하지 않는다.

세트 중복/유형 연속 검사는 5·6·12차시, seed `[0,1,42,123,7919,603756]`, 배정량 `[5,20,35]`에서 실행했다. 세트 내 중복0, 요구 개수 충족, 동일 유형 최장 연속2 이하. 35를 모든 배정량의 기본값으로 바꾸지 않았다.

v3 표본 난이도: BASIC 974 / PRACTICE 3,346 / APPLICATION 2,280 / CHALLENGE 600.

정답 위치는 보기 개수별로 구분했다. 2지선다 609개: index0 320(52.5%), index1 289(47.5%). 3지선다 591개: 200/186/205(33.8%/31.5%/34.7%). 이 표본의 1,200개를 과거 422개와 같은 분모인 것처럼 비교하지 않는다.

### 기존 브라우저/CI 실패

최신 `84fc59f`의 기존 Playwright CI: 47개 중 PASS5 / FAIL27 / NOT_RUN15. 시작 `aed2573`의 [기존 실행](https://github.com/rlasksk030/classgame/actions/runs/35437287815)에서도 같은 수와 실패 시나리오 목록이 확인됐다. 대표 실패는 `/lesson/1`의 팔레트와 답안 Renderer 미발견이다. 원인 전체를 이번 콘텐츠 작업에서 확정하거나 UI를 수정하지 않았다. UI 검증 PASS로 보고하지 않는다.

별도 Node20 `CI` workflow는 `--experimental-strip-types`를 지원하지 않아 실패한다. 시작 커밋에서도 발생한 환경 문제이며 이번에 workflow를 변경하지 않았다.

## 실제 연결 범위와 다음 단계

- `student-api`의 기존 `generateValidatedPracticeSet` 및 교사 `TeacherProblemPreview`의 생성 경로는 기본 v3를 사용한다. 기존 DB 세트는 먼저 조회되어 재생성되지 않는다. 배포하지 않았으므로 운영 API에는 아직 반영되지 않았다.
- 별도 redesign의 5·6·12차시 템플릿/공통·맞춤 배정은 이번 범위에서 유지했다. 신규 은행이 모든 실제 학생 route에서 사용된다고 보고하지 않는다.
- 9차시 `PeerChallengePage`는 코드로 친구 문제를 여는 기존 화면이다. `generatePeerPracticeBank`/`selectPeerPractice`는 은행 및 선택 계약까지 구현·검사했고, 화면 노출은 미연결이다.
- 최소 후속 설계: 기존 인증된 peer 목록 제공 경로에 `source: SYSTEM_PRACTICE`로 구분한 공개 DTO를 추가하고 같은 학급 학생 문제를 먼저 유지한다. 부족할 때만 기본 카드 제공. 비공개 원본/힌트는 기존 서버 채점·힌트 계약에 보관하고 목록에 넣지 않는다. 기존 challenge ID/version 및 학생별 시도·2점/1점 중복 방지 경로를 재사용한다. 가짜 학생 계정을 만들거나 client 점수를 신뢰하지 않는다. 해당 API/화면 연결은 후속 범위 확정 후 진행한다.
- 고정 문항 변경의 원격 반영 때에는 이미 푼 기록과 버전 연결을 보존하는 보정 계획이 필요하다. 이번에 seed/migration을 운영에 실행하지 않았다.

## Git / 외부 영향

- `ab59884`: 콘텐츠 v3·중복 고정 문항·독립 oracle 수용 게이트·24개 peer bank.
- `84fc59f`: 실패하는 품질 게이트와 v3 저장 세트 판별 회귀.
- 마지막 증거 commit: 버전별 seed 보고 표기와 이 보고서/JSON 결과만 포함.
- feature 브랜치 push 허용 범위에서 반영. 기존 미추적 작업은 제외.
- main merge NO / production change NONE / deploy NO / migration NO / installer·Render change NO.
