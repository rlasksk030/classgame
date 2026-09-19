import test from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline, classifyDifficulty } from '../oracle/pipeline.ts';
import type { OracleCandidate } from '../oracle/validate.ts';

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

test('runPipeline accepts an oracle-consistent candidate and rejects a mismatched one', () => {
  const good = baseCandidate({
    code: 'GOOD',
    givenBlocks: [{ x: 0, y: 0, z: 0 }],
    answer: { kind: 'count', value: 1 },
  });
  const bad = baseCandidate({
    code: 'BAD',
    givenBlocks: [{ x: 0, y: 0, z: 0 }],
    answer: { kind: 'count', value: 99 },
  });
  const { accepted, rejected } = runPipeline([good, bad]);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].candidate.code, 'GOOD');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].candidate.code, 'BAD');
  assert.ok(rejected[0].issues.length > 0);
});

test('classifyDifficulty labels constraint-mode problems CHALLENGE regardless of size', () => {
  const constraintProblem = baseCandidate({ problemType: 'BUILD_FROM_VIEWS', gradingMode: 'constraint' });
  assert.equal(classifyDifficulty(constraintProblem), 'CHALLENGE');
});

test('classifyDifficulty labels build tasks APPLICATION and small exact counts BASIC', () => {
  const buildTask = baseCandidate({ problemType: 'BUILD_FROM_HEIGHTMAP', gradingMode: 'exact' });
  assert.equal(classifyDifficulty(buildTask), 'APPLICATION');

  const smallCount = baseCandidate({
    problemType: 'COUNT',
    givenBlocks: [{ x: 0, y: 0, z: 0 }],
    answer: { kind: 'count', value: 1 },
  });
  assert.equal(classifyDifficulty(smallCount), 'BASIC');
});
