# 7·8차시 개념 탐구 직접 조작 수정

## 기준과 재현

- 최신 `release/production`의 `867723a241ee2a01c644d796b076b74289a72045`에서 별도 수정 branch 시작.
- `GuidedExploration`은 count/height-layers/constraints만 editable로 지정하여 height-edit(7), layer-edit(8)의 보관함·직접 조작을 숨겼다.
- 수정 전 학생 `/lesson/7/learn`, `/lesson/8/learn`에서 보관함 노출 검사 **2/2 FAIL**을 확인하고 테스트를 먼저 commit했다.
- 기존 검사는 높이 지도의 ＋/－와 층별 셀만 조작했으므로 3D 편집 누락을 검출하지 못했다.

## 최소 변경

- `src/features/activities/GuidedExploration.tsx`: 7·8차시만 추가로 직접 편집 허용. 같은 blocks에서 높이 지도·층별 모양을 계산하는 기존 단일 상태를 유지한다.
- 3D 조작/지도 편집을 같은 로컬 되돌리기 이력에 기록한다. 거절된 편집과 변화 없는 조작은 이력을 소비하지 않는다. 되돌리기에서도 같은 blocks를 복원하므로 두 표현이 함께 돌아간다.
- 기존 높이 지도는 9층까지 허용한다. 7차시 compact display의 maxHeight를 다음 한 층까지 열어 직접 쌓기가 3층에서 막히지 않게 하되 9층 상한을 유지한다. 12차시 관찰 범위는 바뀌지 않는다.
- `src/features/activities/explorationActivities.ts`: 7·8차시 조작 안내만 양방향 편집에 맞게 수정. 시작 모형·정답·예시·seed 변경 없음.
- 새 기능은 ‘내가 만드는 탐구 모형’으로 표시한다. 관찰 전용 2·3·5차시와 교사 정적 미리보기의 편집 제한은 유지한다.
- `BlockWorld`/`BlockScene`/공통 물리 규칙은 변경하지 않는다. 기존 `moveBlock`, `removeBlock`, `placeOnColumn`, `editExplorationLayer`를 사용한다.

## 검증

| 항목 | 결과 |
|---|---|
| 7차시 직접 쌓기·높이 지도 양방향 동기화 | PASS |
| 8차시 직접 쌓기·층별 모양 양방향 동기화 | PASS |
| 두 층 쌓기·선택·이동·삭제·되돌리기 | PASS |
| 공중 층 추가·받침 블록 삭제/이동 차단 | PASS |
| 거절된 편집이 undo 이력을 소비하지 않음 | PASS |
| 7차시 9층까지 직접 쌓기·상한 유지 | PASS |
| Chromium 터치 두 번·터치 드래그·버튼 배치·취소 | PASS |
| WebKit 터치 두 번·버튼·동기화 | PASS |
| WebKit 합성 PointerEvent drag/cancel handler | PASS (실물 입력 검증 아님) |
| 추가 Chromium UI 회귀 | 6/6 PASS |
| 추가 WebKit UI 회귀 | 6/6 PASS |
| 전체 unit | 795/795 PASS |
| typecheck/lint/build, Edge typecheck, security, seed | PASS |
| 전체 브라우저 회귀 | 로컬 전체 회귀·GitHub CI 결과는 PR 및 최종 배포 보고서에서 확정 |

실물 Android Chrome/iPad Safari/학교 태블릿은 **NOT_VERIFIED**다. WebKit 엔진 검증을 실제 iPad 검증이라고 보고하지 않는다.

학생 route에서 합성 API를 사용하며 `lessonProblems(markGuidedComplete=false)`만 허용했다. 해당 조작 중 저장/채점/진도 위치/XP 요청 **0건**을 확인했다. 새로고침하면 탐구 초기 모형으로 돌아가고 학생 답안·진도는 변경하지 않는다. 교사 preview는 별도의 읽기 전용 `SEED_PROBLEMS` 경로이며 변경 없음.

## CI 및 배포 기준

작업 시작 시 Actions는 enabled=true이고 최신 운영 커밋의 CI/Stacking blocks checks는 SUCCESS였다. 월별 무료 사용량 조회는 현재 CLI의 user 권한이 없어 404로 거절되어 **수치 NOT_VERIFIED**다. 권한을 확대하지 않았다. 로컬 단위·관련 UI 검증 후 한 번에 push하여 중간 실패 push를 줄인다. 실제 원격 CI가 차단되면 그 상태를 기록하고 미실행 검사를 PASS로 취급하지 않는다.

기존 GitHub 증거 삭제, DB·Edge·migration·설치기 수정, 실제 학생/PIN/진도/XP 변경 **0건**. PR 병합·Render 자동 배포 및 SHA 일치 여부는 최종 배포 보고서에서 확인한다.
