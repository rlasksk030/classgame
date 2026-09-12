import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stageProblemIndex } from '../shared/problemSession.ts';
import { practiceSetStatus, generateValidatedPracticeSet, taskFingerprint, practiceDisplaySeed } from '../shared/practiceSet.ts';

test('직접 practice 재접속은 해당 단계의 서버 현재 문항을 복원한다', () => {
  const rows = [{ id: 'learn', stage: 'concept' }, ...['p1','p2','p3'].map(id => ({ id, stage: 'more' }))];
  assert.equal(stageProblemIndex(rows, 'more', null, 'p3'), 2);
  assert.equal(stageProblemIndex(rows, 'more', 'previous-set', 'p3'), 2);
  assert.equal(stageProblemIndex(rows, 'more', 'p2', 'p3'), 1);
  assert.equal(stageProblemIndex(rows, 'more', null, 'learn'), 0);
  assert.equal(stageProblemIndex(rows, 'more', 'previous-set', 'previous-set'), 0);
});

test('실제 DB 공개 문항 형식의 35행 반복을 보존하고 새 20개와 별도 35개를 검증한다', () => {
  type Task = Parameters<typeof taskFingerprint>[0];
  type Row = { code:string; order_index:number; prompt:string; problem_type:Task['problemType']; grid_width:number; grid_depth:number; max_height:number; given:Task['given']; given_blocks:Task['givenBlocks']; choices:string[] };
  const { rows } = JSON.parse(readFileSync(new URL('../qa/practice-sets/2026-09-12-live-investigation/remote-public-problems.json',import.meta.url),'utf8')) as {rows:Row[]};
  const more=rows.filter(p=>p.order_index>2);
  assert.equal(more.length,35);
  const publicTasks=more.map(p=>taskFingerprint({prompt:p.prompt,problemType:p.problem_type,grid:{gridWidth:p.grid_width,gridDepth:p.grid_depth,maxHeight:p.max_height},given:p.given,givenBlocks:p.given_blocks,choices:p.choices}));
  assert.equal(new Set(publicTasks).size,6);
  const before=JSON.stringify(rows);
  for(const count of [20,35]) {
    const fixed=generateValidatedPracticeSet(5,count,603756);
    assert.equal(new Set(fixed.map(taskFingerprint)).size,count);
    assert.deepEqual(fixed,generateValidatedPracticeSet(5,count,603756));
  }
  assert.equal(JSON.stringify(rows),before);
});

test('실제 35행 형태는 기본 추가 1개와 생성 34개/중복 코드 17개로 진단하며 삭제하지 않는다', () => {
  const rows = [{ code: 'L5-03', order_index: 3 }, ...Array.from({length:17},(_,i)=>Array.from({length:2},()=>({code:`GEN-L5-S595837-${String(i+1).padStart(2,'0')}`,order_index:100+i}))).flat()];
  const before = structuredClone(rows);
  const status = practiceSetStatus(rows, 5, 595837, 20);
  assert.equal(status.generatedCount, 34);
  assert.equal(status.supplementalCount, 1);
  assert.equal(status.duplicateCodes, 17);
  assert.equal(status.requiresRepair, true);
  assert.equal(status.targetCount, 20);
  assert.deepEqual(rows, before);
  assert.equal(practiceDisplaySeed(rows,5,603756,595837),595837,'명시적 재시작 전 기존 세트 보존');
  assert.equal(practiceSetStatus(rows,5,603756,20,595837).awaitingReplacement,true);
  const fresh = Array.from({length:20},(_,i)=>({code:`GEN-L5-S603756-${i+1}-V2`,order_index:100+i}));
  assert.equal(practiceSetStatus(fresh,5,603756,20).requiresRepair, false);
  assert.equal(practiceDisplaySeed([...rows,...fresh],5,603756,595837),603756,'새 세트 저장이 확인되면 새 seed 복원');
  assert.equal(practiceSetStatus([{code:'GEN-L5-S1-01',order_index:100}],5,1,5).requiresRepair,false,'옛 버전이라는 이유만으로 불량 세트로 판정하지 않는다');
});
