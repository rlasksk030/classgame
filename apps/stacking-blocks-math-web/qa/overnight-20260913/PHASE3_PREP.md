# Phase 3 준비 — 5~8차시 / DESIGN_ONLY

기준 실행 코드: 762780a7d2e2d4f3612fd4b14df1379ec09ee385 + 시작 시 보존한 작업 트리.
Phase 1B 16/16, Phase 2 최종19/19, 전체 unit81/81과 필수 검사 PASS 후 읽기 분석만 수행했다. 이번 문서의 solver/API는 **제안이며 구현·성능 측정하지 않았다**. 5~8차시 redesign route/문항/DB를 추가하지 않았다.

## 현재 재사용할 실제 경로

| 기능 | 현재 경로 | 판단 |
|---|---|---|
| 좌표 유효성·물리 | shared/blocks.ts: validStructure, canPlace, canRemove, moveBlock | KEEP. 먼저 검증하고 이후 canonicalize. 중복/소수/공중 블록을 정규화로 숨기지 않는다. |
| 투영 | shared/blocks.ts: project | KEEP canonical 저장 계약. 아래 표시 어댑터와 구분. |
| 높이 변환 | shared/blocks.ts: toHeightMap, fromHeightMap | ADAPT 경계검증 필요. fromHeightMap은 소수/범위/직사각형을 검사하지 않으며 toHeightMap은 범위 밖 값 일부를 무시/절단한다. 입력 검증을 먼저 둔다. |
| 층 변환 | shared/blocks.ts: toLayers, fromLayers | ADAPT. fromLayers 자체는 층 포함관계를 검사하지 않는다. |
| 조건 채점 | shared/problems/grading/spatial.ts: gradeSpatial projection-constraints | KEEP. 주어진 방향만 비교하고 유효 구조인지 확인한다. 이는 제출 해의 검사이며 가능한 해 전체 탐색은 아니다. |
| 최솟값/최댓값 | contracts/validate.ts, grading/spatial.ts | NOT_IMPLEMENTED. SOLVER_NOT_IMPLEMENTED / unsupported 반환을 유지한다. |
| 정보 충분성 | grading/spatial.ts: determinability | boolean 정답을 비교할 수 있지만 정답의 충분성 근거를 증명하는 탐색은 없다. |
| 여러 정답 | grading/spatial.ts: multiple-valid-solutions | 명시 목록 검사 가능. 전체 해를 열거한 것으로 간주하지 않는다. |
| 화면/입력 | contracts/display.ts, MathGrid, AnswerRenderer, SpatialMaterials | KEEP. 정규 데이터와 학생 화면의 역변환을 유지한다. |

## 방향 및 해의 의미

앞 관찰자는 -Z, 오른쪽 관찰자는 +X, 높이는 +Y. 옆=오른쪽은 카메라 회전과 독립이다. 저장 계약은 top[z][x], front[y][x], side[y][depth-1-z]. redesign의 실제 오른쪽 화면은 projectionToDisplayGrid(rows,'side')로 행·열을 반전하고 입력은 projectionDisplayCellToMathCoord로 되돌린다. blocks.ts의 오래된 '그대로 화면 출력' 주석을 구현 근거로 삼으면 안 된다. 이번에 학생 좌표/과거 답을 뒤집지 않는다.

모형의 위치/방향은 판에 고정한다. 회전·평행이동을 같은 모형으로 합치지 않는다. 중력 조건에서 모형은 각 자리 정수 높이 h[z][x]로 유일하게 표현되므로 cube 부분집합을 탐색할 필요가 없다. student-visible 정보만 solver 입력으로 사용한다. 원본 hidden blocks나 장식 색상은 제약으로 넣지 않는다.

## 필요한 API와 타입 (아직 존재하지 않는 제안)

```ts
type SearchConstraints = {
  grid: GridConfig;
  projections?: Partial<Record<'top'|'front'|'side', Grid2D>>; // canonical
  heights?: Array<Array<number | null>>; // null: 미공개, 0: 빈 자리 확정
  layers?: Array<Grid2D | null>; // null: 미공개 층
  countRange?: { min: number; max: number }; // 문제에 공개한 경우만
};
type SearchLimits = { maxNodes: number; deadlineMs: number; maxExamples: 2 };
type SearchResult =
  | { status: 'COMPLETE'; solverVersion: 'projection-search-v1';
      solutionCount: string; exists: boolean; uniqueModel: boolean;
      cubeCounts: number[]; exactCountDeterminable: boolean;
      minCount: number | null; maxCount: number | null;
      examples: BlockCoord[][]; visitedNodes: number }
  | { status: 'LIMIT_REACHED' | 'CANCELLED'; visitedNodes: number;
      foundCountLowerBound: string; examples: BlockCoord[][] }
  | { status: 'INVALID'; reason: string };
// searchModels(constraints, limits, signal): SearchResult
// verifyCandidate(constraints, blocks): boolean
// analyzeAddedInformation(before, after): 두 결과와 충분성 변화
```

위 함수들은 shared/problems/solver/ 아래 순수 TS로 설계하고, 브라우저 작업은 별도 Worker 어댑터를 고려한다. 수학 코어가 DOM/Worker/네트워크에 의존하지 않게 한다. 결과 cache 키는 solverVersion + canonical 공개 제약 + 판 크기다. 학생 계정/정답 기록 캐시와 혼합하지 않는다. 새 API나 Worker는 이번에 만들지 않는다.

COMPLETE에서만 전체 solutionCount, count 집합, min/max, 유일성 판정이 확정된다. 해가 0개면 exactCountDeterminable=false, min/max=null. 제한 도달을 '해 없음'이나 '유일해'로 취급하지 않는다. 2개를 찾는 것은 비유일성 반례를 줄 수 있으나 가능한 모든 개수나 최솟값/최댓값의 증명은 아니다.

## 탐색 방법과 한도

1. 입력 차원·bool/정수·범위·공개 제약 비어 있음·모순을 검증한다. 실루엣 각 열은 중력에 따른 연속 채움이어야 한다.
2. 각 h[z][x]의 후보 구간 0..H를 만든다. top false면0, true면1..H. front 높이 F[x], canonical side에서 역변환한 높이 S[z]가 있으면 상한 min(F[x],S[z],H). 공개 height는 정확한 값, layer는 해당 높이 이상/미만 제약이다.
3. 가장 좁은 후보 칸부터 DFS. 고정 순서·후보 순서로 결과와 예시를 결정적으로 유지한다.
4. front의 max_z h[z][x]=F[x], right의 max_x h[z][x]=S[z]를 유지한다. 남은 칸으로 필요한 최대 높이에 도달할 수 없으면 즉시 가지치기. 공개 개수 범위는 현재 합 + 미할당 최소/최대합으로 가지치기한다.
5. 완성 높이마다 validStructure 및 독립 제약 비교. 개수 집합/해 수를 집계하고 예시는 최대2개만 보관한다. 개수가 다른 반례가 있다면 예시2개는 그 반례를 우선한다.
6. cancel/deadline/node limit을 확인한다. 초과 시 부분 결과만 반환하며 출제를 보류한다. 같은 fallback으로 문항 수를 채우지 않는다.

초기 완전 탐색 범위 제안은 W,D≤3,H≤3. 최대 후보 4^9=262,144개, 제약 전 DFS 내부노드까지 약349,525개. 4×4×4는 5^16=152,587,890,625개로 전수검색 대상이 아니다. 초안 maxNodes=1,000,000, deadline=250ms(Worker)지만 **측정하지 않은 예산**이며 저사양 기기 측정 후 확정한다. 완료하지 못하는 제약은 게시 거부/작은 판으로 설계 재검토. 학생 조작 때마다 solver를 실행하지 않는다.

## 독립 기대 fixture (다음 Phase 구현 시 고정 테스트)

| ID | 공개 조건 | 독립 기대값/이유 |
|---|---|---|
| F5-front-only | W1 D2 H3, front 3칸 세로 실루엣만 | 높이쌍 (3,0),(3,1),(3,2),(3,3),(0,3),(1,3),(2,3)의 7해. count집합 {3,4,5,6}, min3 max6, unique=false, exactCount=false. |
| F5-no-hidden | 위 fixture + '숨은 블록 없음'을 정식 가정으로 단층 깊이 점유 제한 | total3. 앞면 셀 수를 세는 조건을 명시한다. 원래 숨은 모형의 개수 사용 금지. |
| F6-multiple | 2×2×2, top모두true, front/right 모두 2칸 높이 | 높이는각1/2. 각 행/열에2가 있어야 함. 대각2두개인2해, 2가3개인4해, 전부2인1해=7해. count {6,7,8}, min6 max8. 예시 [[2,1],[1,2]], [[2,2],[2,2]]. |
| F6-none | 1×1×2, top true, front 높이1, right 높이2 | 해0. 모순 제약으로 출제 거부. |
| F7-exact | height [[2,0],[1,3]] | 블록6, 층 개수3/2/1, front 높이[2,3], 실제 오른쪽 화면의 앞→뒤 열 높이[2,3]. canonical side열은[3,2]. |
| F8-nested | floor: A={(0,0),(1,0)}, layer3 C={(0,0)}, layer2 미공개 | C⊆layer2⊆A이므로 2가지. layer2가C면 total4, A면total5. 중간층 정보 없이 유일 복원이라고 하지 않는다. |
| F8-floating | layer1={(0,0)}, layer2={(1,0)} | subset 위반, invalid. settle로 고쳐 채점하지 않는다. |

위 수치는 손으로 열거한 기대값이며 이번 solver 실행 결과가 아니다. 실제 비대칭 오른쪽 시점은 현재 Phase1B의 고정 기대격자+WebGL 테스트를 유지한다. 다음 Phase에서는 brute force 독립 소형 oracle과 optimized solver를 비교하되 generator와 동일 함수 호출만으로 검증하지 않는다.

## 5차시

충분성 판단은 가능한 cube count 집합이 한 값인지로 판단한다. uniqueModel과 exactCountDeterminable은 별개다. 가정하의 개수, 범위의 최대/최소, 추가 정보 후 판단을 별도 questionIntent로 유지한다. '추가 정보'는 before/after 공개 제약을 각각 탐색하여 실제 count 집합이 좁아지는지 확인한다. 세 방향 정보가 있다고 무조건 unique=true로 만들지 않는다.

카메라/층 보기/블록 수 표시 등 정보 노출 정책은 자료 계약에 포함한다. 제한 상태에서 원본 blocks.length나 layer-control로 정답을 미리 볼 수 없어야 한다. solver 결과 근거/버전은 문항과 연결하고 기존 문제를 몰래 다시 채점하지 않는다. 난이도 **높음**: 수학적 충분성과 단계별 정보 공개를 함께 보증해야 한다.

## 6차시

top/front/right 제약에서 여러 해를 허용한다. 새 모형 제출은 기존 projection-constraints 채점으로 검증할 수 있다. 예시와 다른 모형이어도 공개 제약을 만족하면 통과. 출제 시 해 존재·개수 집합·대표 다른 해를 solver로 검증한다. exact-block-coordinates와 constraint 모드를 혼동하지 않는다. 난이도 **높음**.

## 7차시

직사각형 높이 입력, 정수0..maxHeight, 명시된 W×D, null(미입력)과0(빈칸) 구분을 먼저 검증한다. 검증 후 fromHeightMap→validStructure→toHeightMap exact roundtrip. total=sum(height), front/right는project와display adapter로 생성. deterministic height generator로 가능하며 전체 지도라면 solver가 필요 없다. 부분 지도/최소최대는 별도 solver 문제로 분리. 기존 입력의 빈 문자열→0 처리 정책은 새 문항에서 명확히 정한다. 난이도 **중간**.

## 8차시

각 층은 같은 W×D, layers[n+1]⊆layers[n] 검증 후 fromLayers→validStructure. count=sum모든채움, height=sum각자리의층점유. 빈 최상층의 표시/생략 정책과 maxHeight는 분리해 저장한다. 중간층이 비었는데 위층이 차면 invalid. 미공개 중간층은 아래/위 사이의 부분집합이 여러 개일 수 있으므로 원본 모양 하나를 정답으로 강제하지 않는다.

다음 층 규칙 문제는 규칙을 명시하거나 여러 가능한 답을 인정한다. 그림 몇 장만으로 유일한 규칙이 있다고 간주하지 않는다. 전체층 변환은 deterministic, 빠진층/조건 추론은 solver 또는 작은 부분집합 열거가 필요하다. 난이도 **중간**, 추론 확장은 **높음**.

## 권장 구현 순서와 다음 게이트

1. 입력검증+공개 제약 계약+작은독립fixture, 제한·미완료 결과 계약.
2. 높이변수 solver core(소형판), complete/timeout 구분, 저사양 성능 측정.
3. 7차시 exact height / 8차시 full layers 먼저 구현, 입력·제출·복원 실제 브라우저 검사.
4. 6차시 다중해·예시복원·최소/최대, 이후 5차시 충분성·추가정보 전환.
5. 기존1~4차시 방향·마우스/터치·시도·복원 회귀. 모든 새 차시 Learn/Solve/Practice 실제 브라우저 게이트.

원격 저장/배포 및 설치 간소화는 이 준비 문서로 승인된 것이 아니다. 운영 데이터·기존 schema·PIN·Secret과 5~8차시 기존 페이지는 변경하지 않았다.
