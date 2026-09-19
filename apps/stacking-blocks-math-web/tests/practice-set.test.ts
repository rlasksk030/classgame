import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePracticeProblems } from '../shared/practiceGenerator.ts';
import { auditPracticeSet, generatedProblemId, generateValidatedPracticeSet, selectPracticeRows, taskFingerprint, isAssignedPracticeCode } from '../shared/practiceSet.ts';
import { grade } from '../shared/grading.ts';

test('새 35문항은 번호·숨은 모형을 제외한 공개 과제가 반복되지 않는다', () => {
  const set = generateValidatedPracticeSet(5, 35, 123,2);
  const tasks = set.map(p => JSON.stringify([p.prompt, p.given.projections ?? p.givenBlocks, p.choices]));
  assert.equal(new Set(tasks).size, 35);
});

test('구버전 35문항 재현 및 내용 중복 변형 탐지', () => {
  assert.ok(auditPracticeSet(generatePracticeProblems(5,35,123,1)).duplicates.length>0);
  const p=generateValidatedPracticeSet(5,35,123,2)[0];
  const copies=Array.from({length:35},(_,i)=>({...p,code:`different-${i}`,seed:i,givenBlocks:[...p.givenBlocks,{x:0,y:0,z:2}]}));
  assert.equal(auditPracticeSet(copies).uniqueTasks,1);
  assert.equal(auditPracticeSet(copies).longestRun,35);
  assert.equal(taskFingerprint(p),taskFingerprint({...p,choices:[...p.choices].reverse()}));
});

test('5차시 35개는 6계열이며 결정적으로 복원되고 기존 v1을 바꾸지 않는다', () => {
  for(const seed of [0,1,123,7919,999999]) {
    const set=generateValidatedPracticeSet(5,35,seed,2); const audit=auditPracticeSet(set);
    assert.equal(audit.uniqueTasks,35); assert.equal(Object.keys(audit.families).length,6); assert.ok(audit.longestRun<3);
    assert.deepEqual(set,generateValidatedPracticeSet(5,35,seed,2));
    assert.ok(set.every(p=>p.generatorVersion===2 && p.code.endsWith('-V2')));
  }
  assert.equal(generatePracticeProblems(5,1,123,1)[0].generatorVersion,1);
});

test('5차시 여러 seed·실제 배정량에서 고유성과 짧은 세트 배분을 보존한다', () => {
  for(const seed of [0,1,2,3,42,123,7919,595837,603756,999999]) {
    for(const count of [5,10,15,20,35]) {
      const set=generateValidatedPracticeSet(5,count,seed,2), audit=auditPracticeSet(set);
      assert.equal(audit.count,count); assert.equal(audit.uniqueTasks,count);
      assert.equal(audit.longestRun,1);
      assert.equal(Object.keys(audit.families).length,Math.min(count,6));
      assert.deepEqual(set,generateValidatedPracticeSet(5,count,seed,2));
      for(const p of set) {
        assert.equal(grade({...p,submission:p.answer}).correct,true);
        if(p.templateId==='lesson5-hidden-min'||p.templateId==='lesson5-hidden-max') {
          const cells=p.given.projections!.front!.flat().filter(Boolean).length;
          assert.deepEqual(p.answer,{kind:'count',value:cells*(p.templateId==='lesson5-hidden-max'?p.grid.gridDepth:1)});
        }
      }
    }
  }
  for(const count of [0,-1,101,1.5]) assert.throws(()=>generateValidatedPracticeSet(5,count,123,2),/PRACTICE_SET_UNSUPPORTED/);
});

test('이미 생성된 세트 재조회에서도 다른 seed/학생 문항을 섞지 않는다', () => {
  const rows=[{code:'L5-01'},{code:'GEN-L5-S123-01'},{code:'GEN-L5-S999-01'},{code:'GEN-L5-S123-02-V2'}];
  assert.deepEqual(selectPracticeRows(rows,5,123),[rows[0],rows[1],rows[3]]);
  assert.deepEqual(selectPracticeRows(rows,5,999),[rows[0],rows[2]]);
});

test('같은 정답은 서로 다른 공개 자료를 중복으로 만들지 않는다', () => {
  const set=generateValidatedPracticeSet(5,35,123,2).filter(p=>p.problemType==='CHOICE');
  assert.equal(new Set(set.map(taskFingerprint)).size,set.length);
});

test('개별 생성 문항 접근도 현재 배정 seed/차시와 비교한다',()=>{
  assert.equal(isAssignedPracticeCode('GEN-L5-S123-01-V2',5,123),true);
  assert.equal(isAssignedPracticeCode('GEN-L5-S1234-01-V2',5,123),false);
  assert.equal(isAssignedPracticeCode('GEN-L6-S123-01-V2',5,123),false);
  assert.equal(isAssignedPracticeCode('GEN-L5-S999-01-V2',5,123),false);
});

test('동시 생성·재시도에서도 같은 문항은 같은 DB PK를 사용한다',async()=>{
  const a=await generatedProblemId('GEN-L5-S123-01-V2');
  assert.equal(a,await generatedProblemId('GEN-L5-S123-01-V2'));
  assert.notEqual(a,await generatedProblemId('GEN-L5-S124-01-V2'));
  assert.match(a,/^[a-f\d]{8}-[a-f\d]{4}-8[a-f\d]{3}-a[a-f\d]{3}-[a-f\d]{12}$/);
});

test('5차시 가정/최대의 개수는 공개 앞면에서 독립 계산하며 원본 총개수로 바꾸지 않는다',()=>{
  for(const p of generateValidatedPracticeSet(5,35,123,2)) {
    if(p.answer.kind!=='count'||p.given.allowRotate!==false) continue;
    let expected=0;
    for(const row of p.given.projections!.front!) for(const filled of row) if(filled) expected++;
    if(p.problemType==='COUNT_AMBIGUOUS') expected*=p.grid.gridDepth;
    assert.equal(p.answer.value,expected);
    assert.equal(grade({...p,submission:{kind:'count',value:expected}}).correct,true);
    assert.equal(grade({...p,submission:{kind:'count',value:expected+1}}).correct,false);
  }
});
