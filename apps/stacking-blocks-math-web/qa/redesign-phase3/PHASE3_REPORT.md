PHASE 3 RESULT: PASS

## 범위와 검증 대상

- LOCAL ONLY / UI_WITH_TEST_DATA / VERIFIED_LOCAL. 이번 Phase 3의 게이트 통과이며 전체 서비스 배포 완료가 아니다.
- Branch: `feature/spatial-math-redesign-v1`
- 시작 HEAD: `efb878d7517cfa60b5becc61e385af2b194fdc46`
- 구현 커밋: `b1638f9` (solver·5~8차시), `a7a51b6` (7·8차시 자유 시점), `89793e4` (고정 시점 안내·QA 포커스 조건).
- 최종 실행 코드 HEAD: `89793e43b211901b3aa45600baf4528e7643a65e`. 이후 커밋은 이 보고서와 검증 증거만 포함한다.
- 기존 미커밋 10개 파일을 포함한 작업 트리의 production build를 검사했다. 깨끗한 HEAD만의 검증이라고 주장하지 않는다. [보존 비교](preservation.json)의 10개 모두 동일.
- 실행 시작: 2026-09-13T00:33:57.093Z UTC (2026-09-13 09:33 KST). 각 검사 종료 시각은 [release-checks.json](release-checks.json), 브라우저 시각/기간은 [원본 결과](../redesign-browser/89793e4-2026-09-13T00-33-57-072Z/report.json)에 있다.
- Source SHA256: `6f39ede78b963d72b8ed36f1cfee3495275a191300d40a8743540d2f6d411ae9`
- Production build SHA256: `9badec09b7cfff783a344e6c312087ab5d50e611ded1a55c579d57f4d2615ed2`
- 경로: `/student/lesson/5/redesign` ~ `/student/lesson/8/redesign`. 기존 운영 `/lesson/*` 및 curriculum/문제 DB를 덮어쓰지 않았다.

## 실제 구현

| 영역 | 코드 | 동작 |
|---|---|---|
| Solver | `shared/problems/solvers/projection.ts` | 열별 높이 DFS, 상한·합·남은 최대값 pruning, 완전/상한/취소/잘못된 조건 분리 |
| 문제 계약·채점 | `shared/problems/contracts/`, `grading/spatial.ts` | 입력별 채점, solver 증거·분류 검증, min/max, 전체 constraint 후보 검증 |
| 차시 문제/활동 | `shared/problems/templates/phase3.ts` | 5개 행동형 Learn, 공통6+오답 conceptTags 맞춤4/3, 결정적 Practice5+5 |
| 진행 | `shared/progress/phase3.ts`, `src/features/learning/Phase3Redesign.tsx` | 단계 잠금, 현재 문항·입력·시도·공개 상태 기기 내 복원 |
| 공통 표현 | `AnswerRenderer`, `MathGrid`, `SpatialMaterials`, `ActivityBuilder` | 실제 선택/숫자/투영/높이/층/3D 입력, 부분 높이의 ? 표시, 카메라 정책 전달 |
| 회귀 | `e2e/redesign-phase3.spec.ts`, 기존 `qa:redesign` | 실제 학생 route production Chromium, 클릭·입력·제출·재접속 검사 |

## Solver 검증과 성능

- 범위: 최대 각 변4, 바닥12자리, 높이4. 10차시 큰 설계판은 탐색 대상이 아니다.
- 입력: top/front/right-side, 높이(일부 미지수 포함), 층(중간 미지층 포함), givenBlocks, exactCount.
- 내부 좌표 그대로 front=-Z / right=+X / top=+Y. side canonical 열은 depth-1-z, 기존 표시 역변환을 재사용한다. 저장 좌표 반전 없음.
- top 빈칸은 높이0, 채운 칸은 1 이상. front/side 최대높이 상한 및 아직 남은 열로 목표 최대높이를 만들 수 있는지 검사. exactCount는 남은 최소/최대 합으로 가지치기.
- 해0 / 유일해 / 여러 모양·같은 개수 / 여러 모양·다른 개수를 구분. LIMIT_REACHED/CANCELLED는 개수 하한만 반환하며 유일해·정확한 min/max로 출제하지 않는다.
- 고정 독립 기대값: 2×2 높이2, 세 방향을 모두 채우는 조건은 7가지·개수6/7/8·min6/max8. exactCount6은 두 모양, exactCount8은 유일해. 1×2 높이3은 별도 이중 반복으로 높이쌍을 직접 세어 대조한다. 비대칭 오른쪽 격자도 수기로 정한 값과 대조한다.
- S01~S13을 포함한 solver suite 12/12 PASS. height/layer 왕복, 물리조건, 중간층 다중/유일, 취소·상한도 검사.
- 최종 Mac 측정: 무조건 3×3×3 전체 262,144해 탐색 20.7ms. 3×3×4 및 4×3×3은 1,000,000 노드 상한에서 각각 50.6/67.8ms에 LIMIT_REACHED. 끝내지 못한 탐색의 해 수는 완전한 결과가 아니다.
- seed 0/1/2/97/123/314159/2147483647, 네 차시 공통·Practice 308개 생성 성능 표본 10.4ms. 이는 모든 seed의 교육적 다양성 검증이 아니며 Chromebook 실기기 성능도 아니다. [측정 원본](performance.json), [재현 스크립트](benchmark.mjs).
- Solver는 문제 묶음 생성 시 계산하고 화면의 묶음을 memoize한다. 블록 조작은 기존 로컬 Builder 상태만 변경한다. 제출은 열거 탐색 없이 후보 제약만 확인한다.

## 차시별 실제 완주

| 차시 | Learn | Solve | Practice | 내용과 근거 |
|---|---:|---:|---:|---|
| 5 | 5/5 | 10/10 | 5/5 | 고정 사선 쌓기, 숨은 부분 강조 비교, 충분성 양쪽 판단, 추가 오른쪽 자료, 최소/최대. [완주](../redesign-browser/89793e4-2026-09-13T00-33-57-072Z/screenshots/l5-complete.png) |
| 6 | 5/5 | 10/10 | 5/5 | top 1층→front→right-side, 이전 블록 유지, 여러 해 비교, constraint 채점. [완주](../redesign-browser/89793e4-2026-09-13T00-33-57-072Z/screenshots/l6-complete.png) |
| 7 | 5/5 | 9/9 | 5/5 | 높이3 한 열을 직접 쌓기, 정확 복원·합·앞/오른쪽·유일한 빈 숫자. [완주](../redesign-browser/89793e4-2026-09-13T00-33-57-072Z/screenshots/l7-complete.png) |
| 8 | 5/5 | 9/9 | 5/5 | 1→2→3층 누적쌓기, 높이 변환, 오류층 판별, 명시한 규칙, 별도 유일 중간층. [완주](../redesign-browser/89793e4-2026-09-13T00-33-57-072Z/screenshots/l8-complete.png) |

20개 Learn 행동 + 38개 Solve + 20개 기본 Practice를 실제 입력했다. 기본 완주와 추가 독립 사례는 중복될 수 있으므로 모두 합쳐 고유 문항 수로 보고하지 않는다.

5차시 추가 정보는 가로 한 자리라는 조건에서 오른쪽 옆이 각 높이를 결정함을 solver로 확인한 사례다. 일반적으로 세 방향이면 항상 유일하다고 가르치지 않는다. 첫 사선 문제는 공개된 세 기둥과 숨은 열0~2층이라는 명시 조건 아래 9/10/11개가 가능하다.
6차시 문제는 모든 seed에서 위·앞·옆 자료 세 개를 제공한다. 6개짜리 대표 예시와 다른 8개짜리 모형도 같은 세 투영을 만족하면 실제 UI 제출에서 정답이다.
8차시 잘못된 층 자료는 ‘오류를 찾는 문제’로 명시했고 실제 복원용 정답으로 쓰지 않는다. 규칙은 검증된 고정 3→2→1→0, 한 층마다 1개 감소 규칙으로 제한했다.

## 실제 브라우저 결과

기존 `npm run qa:redesign`: 계획29 / 실행29 / PASS29 / FAIL0 / NOT_RUN0 / flaky0 / retry0.
[최종 요약](../redesign-browser/89793e4-2026-09-13T00-33-57-072Z/report.md), [원본 JSON](../redesign-browser/89793e4-2026-09-13T00-33-57-072Z/report.json), [build/소스 식별](../redesign-browser/89793e4-2026-09-13T00-33-57-072Z/identity.json).

- P35~P38: 네 차시 모든 단계 완주, 활동3/문제3 새로고침, 단계 왕복, 기본 Practice 완료 복원.
- P39: 오답1/2/3 후 힌트만, 네 번째 후 숫자 정답·이유, 재구성 요구 없음, 수정·재제출 성공.
- P40: 실제 Babylon 정답 예시, ‘가능한 모양 중 하나’, 원본과 다른 유효 구조 인정.
- P41: 1024×768 touch-enabled Chromium에서 실제 마우스 보관함 drag, CDP 터치 drag, tap-to-place. 블록 배열 주입으로 대체하지 않았다.
- P42: 별도 유일한 중간층 문제 실제 셀 입력·새로고침·제출.
- P43: 서로 독립된 context 7개에서 미제출 선택/판단/숫자/블록/투영/층/높이 답안 복원 후 제출.
- P44: ‘알 수 있어요’/‘알 수 없어요’ 모두 실제 선택 제출. 숫자 입력이 없음을 확인.
- 모든 완주 Builder 입력은 기존 접근성 보조 ‘버튼으로 놓기’를 직접 조작했다. 이 검사를 drag 성공과 혼동하지 않는다. drag/touch/tap는 P41 및 기존 T07/T08에서 별도로 검사했다.
- 1차시 P21, 2차시 P22, 4차시 P24 전체 흐름과 기존 3차시 T01~T13 및 로그인/legacy grid T14/T15/R16 총19건 회귀 PASS. 오른쪽 비대칭 실렌더, 사각 셀, Undo/Redo도 포함.

## 화면 증거와 직접 검토

아래는 이번 최종 build의 실제 Chromium 캡처이며 합성 시안이 아니다.

- [5차시 고정 사선](../redesign-browser/89793e4-2026-09-13T00-33-57-072Z/screenshots/l5-fixed-oblique.png): fixed 표시·버튼 차단, 동일 포커스에서 드래그 전후 PNG 완전 일치. 원본 두 캡처는 P35 trace/attachments에 보존.
- [6차시 다른 해와 정답 비교](../redesign-browser/89793e4-2026-09-13T00-33-57-072Z/screenshots/l6-alternative-reveal.png): 세 자료, 6개 예시와 8개 학생 답을 함께 표시.
- [7차시 빈 높이](../redesign-browser/89793e4-2026-09-13T00-33-57-072Z/screenshots/l7-learn-5.png): 실제 ? 지도, 앞/옆 방향, 계산 설명.
- [8차시 층 누적](../redesign-browser/89793e4-2026-09-13T00-33-57-072Z/screenshots/l8-learn-2.png): 층 그림 가로 배치, 앞/옆 기준, 이전 층 보존.
- [1024×768 실제 입력](../redesign-browser/89793e4-2026-09-13T00-33-57-072Z/screenshots/l6-tablet-input.png), [중간층](../redesign-browser/89793e4-2026-09-13T00-33-57-072Z/screenshots/l8-middle-layer.png).
- 큰 글자·터치 영역을 유지하므로 긴 문제/정답 비교 화면에는 세로 스크롤이 남는다. 층 자료를 세로로 세 장 늘어놓는 방식은 쓰지 않는다. 모든 화면을 한 viewport 안에 맞췄다는 주장은 하지 않는다.

## 실패 및 수정 이력 보존

1. 최초 sandbox preview는 listen EPERM, browser0/BLOCKED. 같은 실패를 우회 반복하지 않고 승인된 로컬 실행 권한으로 기존 runner를 실행했다.
2. 초기 구현 검사27/27 PASS는 중간 결과로만 보존. 최종 판정에 재사용하지 않았다.
3. b1638f9 검사는 P35에서 입력 전후 canvas 포커스 테두리 차이를 회전으로 잘못 비교해 FAIL. 실패 캡처에서 테두리를 확인했고 양쪽 focus 조건을 같게 했다. 회전 금지 기대값 및 PNG 완전 일치 검사는 유지했다.
4. 코드 검토로 6차시 두 방향만 제공할 수 있는 분기, 7·8차시 고정 시점 기본값, 고정 화면의 회전 안내 모순을 수정했다.
5. b1638f9 build는 수정 이후 구버전이 되어 자체 QA만 SIGINT로 종료. PASS10/FAIL1/중단1/미실행17 증거를 보존했다. 실패를 skip하거나 최신 PASS에 합산하지 않았다.
6. 보조 E2E 형식검사에서 존재하지 않는 tsconfig.e2e.json을 지정한 실행 오류는 보존했다. 실제 기존 테스트 파일과 명시 옵션을 사용한 최종 E2E 형식검사는 PASS.
7. 89793e4에서는 소스를 고정하고 build부터 29개 전체를 재실행해 PASS했다.

## 최종 명령 검사

| 검사 | 결과 |
|---|---|
| npm test | 101/101 PASS |
| 별도 solver suite | 12/12 PASS (전체 unit에 포함) |
| npm run typecheck | PASS |
| npm run lint | PASS |
| npm run build | PASS |
| npm run typecheck:edge | PASS |
| npm run test:security | PASS (로컬 Deno 검사) |
| E2E TypeScript | PASS |
| npm run qa:redesign | 29/29 PASS |

명령/소스 HEAD/UTC 시각은 [release-checks.json](release-checks.json). 모든 검사에는 이미 있던 미커밋 수학 변경이 포함된다. `dist/` build는 별도 runner 로그로 증명한다.

## 저장/정답 보호 및 미검증

- IMPLEMENTED_LOCAL / ANSWER_PROTECTION_NOT_REMOTE_VERIFIED.
- 설치 URL·installationId·학생·학급·차시·버전으로 기기 내 키를 구분하며 기존 기록 키를 덮어쓰지 않는다. 로컬 session 형식만으로 실제 서버 인증 성공을 주장하지 않는다.
- 실제 문제/활동 번호, 선택·판단·숫자·격자·높이·층·블록 및 오답/정답공개/완료 상태의 동일 브라우저 새로고침 복원은 PASS.
- Local redesign 문제에 채점 정책 및 대표 답이 들어 있어 개발자 도구로 접근 가능하다. 실제 학생 DTO/서버 정답 보호 경계는 아직 구현·검증이 끝나지 않았다. 운영 배포용 정답 보호 PASS가 아니다.
- 실제 Supabase 저장·교사 진도 연계·다른 기기 복원·실제 iPad/Safari·production deploy 미검증. 이번 브라우저의 모든 원격 요청은 차단했고 운영 기록은 읽거나 쓰지 않았다.
- INSTALL_EASY는 별도 필수 미완료. 이번 작업으로 줄인 교사 외부 수동 작업0개, 신규 설치/업데이트 실검증 없음. 새 실행부/유료 서비스/OAuth/Worker 준비·생성·배포를 하지 않았다.
- 이전 전체 QA/P0 및 운영 curriculum 전환은 별도 미완료로 유지. 이번 Phase 3 PASS를 전체 앱 완료로 확대하지 않는다.
- push NO / deploy NO / remote migration NO / 학생·PIN·진도·작품·Secret 변경 NO.
