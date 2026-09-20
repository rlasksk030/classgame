# 안내된 탐구 전수 감사·수정

검증 기준: 시작 HEAD `5ff6fb48a86df54e93df36b04490feb191e93453` + `verified-source-sha256.json`의 수정 소스. 브랜치 `feature/spatial-math-redesign-v1`.

## 원인과 범위

실제 StudentWorld → `/lesson/:lesson/learn` → LessonLearnPage가 모든 차시에 빈 blocks와 편집 가능한 BlockWorld를 공통 렌더링했다. 문제은행의 FREE_BUILD 타입 fallback이 아니라 화면 구현의 공통 자유 쌓기 기본값이었다. 차시별 설명만 달랐다.

LessonLearnPage가 명시적 EXPLORATIONS 매핑을 선택하고, GuidedExploration이 차시별 조작을 실행한다. 없는 차시는 자유 쌓기로 대체하지 않는다. 학생 월드의 기존 10·11차시 `/lesson/:lesson/project` 경로는 유지한다. 해당 learn 주소에서도 같은 ArchitecturePage를 재사용한다. 9차시는 기존 PeerChallengePage를 재사용한다. 교사의 `/teacher/problem-preview`는 개별 문제 미리보기로 별도이며 변경하지 않았다.

문제 데이터·정답·generator·grading·oracle·API·schema·redesign 코드는 변경하지 않았다. 3차시 캡처 검토 중 발견한 오른쪽 옆 저장 격자와 +X 카메라의 좌우 차이는 안내된 탐구의 표시 변환만으로 해결했다. 저장 좌표나 채점 좌표는 그대로다.

## 차시별 실제 연결과 검증

| 차시 | 관찰 / 조작 / 발견 | 구현 | 실제 브라우저 assertion |
|---|---|---|---|
| 1 | 자리·층 / 쌓고 개수 예측 / 실제 개수 비교 | count | 배치 후 6개 예측·비교 |
| 2 | 같은 입체 / 다섯 방향 관찰 / 방향에 따른 차이 | viewpoints | 앞·뒤·왼쪽·오른쪽·위 카메라, 편집 도구 없음 |
| 3 | 입체와 투영 / 방향 전환 / 대응 격자 | projections | 카메라·격자 전환 및 오른쪽 옆 셀 방향 |
| 4 | 높이·층별 지도 / 추가·제거 / 세 합의 일치 | height-layers | 배치 후 높이 합=층별 합=전체 6, 3층 표시 |
| 5 | 앞 격자 하나 / 판단 후 두 모형·추가 정보 비교 / 정보 부족 | information | 최초 3D 미공개, 동일 앞모습에서 3개·4개 비교 |
| 6 | 고정 세 방향 조건 / 직접 구성·예시 전환 / 여러 해·최소·최대 | constraints | 실제 6개 구성, 조건 만족, 최소6·최대8 |
| 7 | 높이 지도 / 숫자 증가·감소 / 입체 복원 | height-edit | 실제 수량 5→6→5 |
| 8 | 층별 지도 / 층 선택·셀 켜기·끄기 / 아래 지지 관계 | layer-edit | 부유 칸 거부, 유효 칸 추가·제거, 층 보기 |
| 9 | 공개 카드·힌트 / 문제 제작·친구/기본 문제 선택 / 공개 조건 | PeerChallengePage | 기본 문제24, 실제10개 배치 후 카드 선택 진입 |
| 10 | 자유 작품 / 기존 건축 도구·저장 / 여러 표현 가능한 작품 | ArchitecturePage | 저장 후 기존 project 경로에서 제목 복원 |
| 11 | 저장 작품 / 표현 확인·용도 기록 / 작품 설명 | ArchitecturePage | 10차시 동일 작품 연결, 용도 저장·새로고침 복원 |
| 12 | 여러 표현 / 높이 편집·표현 전환·자기평가 / 같은 입체 연결 | connections + ReviewSummary | 수량·세 투영·층 표시, 자기평가 저장·새로고침 복원 |

1~8·12의 탐구 조작은 문제 답안·점수로 저장하지 않는 활동이다. 12 자기평가와 9~11 저장은 기존 경로를 그대로 사용한다. 6차시 최솟값·최댓값은 명시된 2×2, 높이2, 지지 조건의 작은 전체 경우만 탐색하며 범용 입체/사선 그림의 유일성을 주장하지 않는다.

## 실행 결과

- 관련 단위 검사: **5 PASS**. 12개 매핑, 5차시 반례, 6차시 독립 높이 열거, 8차시 지지, 옆 방향 표시 불변성.
- 새 브라우저 검사: **13개 고유 시나리오 모두 PASS** (1~12차시 + 잘못된 차시). 여러 실행의 최종 통과 합계이며 단일 실행 결과로 표기하지 않는다.
- 기존 `e2e/live-flow.spec.ts`: **6 PASS**, 이번 작업에서 실행. 이후 탐구 표시만 바꾼 변경은 영향받은 새 검사로 재검증했다.
- 마지막 표시 수정 후 L3/L6/L12: **3/3 PASS**.
- 최신 소스 `npm run typecheck`, `npm run lint`, `npm run build`: **PASS**.
- oracle 및 전체 browser suite 재실행 없음.

명령:
```sh
node --experimental-strip-types --test tests/guided-exploration.test.ts
npx --no-install playwright test e2e/guided-exploration.spec.ts e2e/live-flow.spec.ts --workers=1
# 최종 표시 변경의 영향 검사
npx --no-install playwright test e2e/guided-exploration.spec.ts --grep 'L3 |L6 |L12 ' --workers=1
npm run typecheck
npm run lint
npm run build
```

환경: 기존 Playwright 실행기, production build의 실제 학생 route, Chromium, 로컬 preview `127.0.0.1:4173`, 독립 합성 학생 세션 및 기존 live-fixture/PGlite 저장 계약. `UI_WITH_TEST_DATA`이며 LIVE_SUPABASE 검증이 아니다. 기존 전체 suite·운영 서비스는 실행/변경하지 않았다.

초기 실패는 저장 복원된 textarea의 label 선택자와 실제 카메라 표시명 차이였다. 실제 저장값 assertion을 유지하고 접근성 textbox 이름 및 실제 표시명으로 선택자를 수정했다. 생성된 Playwright HTML의 번들 JS가 lint에 잡힌 경우는 QA 산출물 폴더로 옮겼으며 lint 규칙은 완화하지 않았다. 영문 테스트 제목에 한글 grep을 사용한 1회는 실행0건으로 집계하지 않았다.

12개 화면을 캡처하고 직접 검토했다. `screenshots/guided-lesson-N.png`는 합성 활동 화면이다. 마지막 3차시 이미지의 입체와 오른쪽 옆 격자 방향도 직접 비교했다. 초기 실패 trace는 로컬 `test-results/guided-exploration*`에 보존하고 Git에는 넣지 않는다.

## 남은 검증 경계

원격 TEST 배포 화면·실제 iPad/Safari는 이번 작업에서 미검증. 기존 9~11차시 전체 기능을 다시 인증한 것이 아니라 안내된 탐구 진입과 해당 연속 경로를 검사했다. production 변경·원격 migration·원격 배포 없음.
