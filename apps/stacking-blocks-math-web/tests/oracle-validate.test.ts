import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCandidateGeometry, validateCandidateConstraint, type OracleCandidate } from '../oracle/validate.ts';

const grid = { gridWidth: 2, gridDepth: 2, maxHeight: 2 };

function baseCandidate(overrides: Partial<OracleCandidate>): OracleCandidate {
  return {
    code: 'TEST',
    lesson: 1,
    problemType: 'COUNT',
    gradingMode: 'exact',
    grid,
    givenBlocks: [],
    startBlocks: [],
    given: {},
    answer: { kind: 'count', value: 0 },
    choices: [],
    ...overrides,
  };
}

test('a self-consistent COUNT candidate has no geometry issues', () => {
  const candidate = baseCandidate({
    givenBlocks: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
    answer: { kind: 'count', value: 2 },
  });
  assert.deepEqual(validateCandidateGeometry(candidate), []);
});

test('a wrong total-count answer is caught', () => {
  const candidate = baseCandidate({
    givenBlocks: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
    answer: { kind: 'count', value: 3 },
  });
  const issues = validateCandidateGeometry(candidate);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].field, 'answer.value(total count)');
  assert.equal(issues[0].oracleValue, 2);
});

test('a COUNT_AMBIGUOUS candidate with no rotation and no reference data is flagged unsolvable', () => {
  const candidate = baseCandidate({
    problemType: 'COUNT_AMBIGUOUS',
    givenBlocks: [{ x: 0, y: 0, z: 0 }],
    given: { allowRotate: false },
    answer: { kind: 'count', value: 1 },
  });
  const issues = validateCandidateGeometry(candidate);
  assert.ok(issues.some((i) => i.field === 'count_ambiguous solvability'));
});

test('a COUNT_AMBIGUOUS candidate that gives a front view is not flagged unsolvable', () => {
  const candidate = baseCandidate({
    problemType: 'COUNT_AMBIGUOUS',
    givenBlocks: [{ x: 0, y: 0, z: 0 }],
    given: { allowRotate: false, projections: { front: [[true, false], [false, false]] } },
    answer: { kind: 'count', value: 2 },
  });
  const issues = validateCandidateGeometry(candidate);
  assert.equal(issues.some((i) => i.field === 'count_ambiguous solvability'), false);
});

test('a fully pinned exact BUILD_FROM_VIEWS candidate passes the DFS uniqueness check', () => {
  const candidate = baseCandidate({
    problemType: 'BUILD_FROM_VIEWS',
    grid: { gridWidth: 1, gridDepth: 1, maxHeight: 1 },
    given: { projections: { top: [[true]], front: [[true]], side: [[true]] } },
    answer: { kind: 'blocks', blocks: [{ x: 0, y: 0, z: 0 }] },
  });
  const { issues, dfsResult } = validateCandidateConstraint(candidate);
  assert.deepEqual(issues, []);
  assert.equal(dfsResult?.uniqueness, 'UNIQUE');
});

test('an exact BUILD_FROM_VIEWS candidate whose view is actually ambiguous is caught by DFS', () => {
  const candidate = baseCandidate({
    problemType: 'BUILD_FROM_VIEWS',
    grid: { gridWidth: 2, gridDepth: 2, maxHeight: 1 },
    given: { projections: { front: [[true, true]] } },
    answer: { kind: 'blocks', blocks: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }] },
  });
  const { issues } = validateCandidateConstraint(candidate);
  assert.ok(issues.some((i) => i.field === 'constraint uniqueness'));
});

test('a BUILD_FROM_VIEWS candidate whose view has no valid structure is caught by DFS existence', () => {
  const candidate = baseCandidate({
    problemType: 'BUILD_FROM_VIEWS',
    gradingMode: 'constraint',
    grid: { gridWidth: 1, gridDepth: 1, maxHeight: 1 },
    given: { projections: { top: [[false]], front: [[true]] } },
    answer: { kind: 'blocks', blocks: [] },
  });
  const { issues, dfsResult } = validateCandidateConstraint(candidate);
  assert.equal(dfsResult?.exists, false);
  assert.ok(issues.some((i) => i.field === 'constraint existence'));
});
