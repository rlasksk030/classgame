import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requiredSolveIds} from '../shared/lessonProgression.ts';
test('live learn activity does not require an unreachable graded concept attempt',()=>{
 assert.deepEqual(requiredSolveIds([{id:'learn',stage:'concept'},{id:'solve',stage:'check'},{id:'extra',stage:'more'}]),['solve']);
});
test('all solve problems remain required; optional practice never unlocks itself',()=>{
 assert.deepEqual(requiredSolveIds([{id:'a',stage:'check'},{id:'b',stage:'check'},{id:'c',stage:'more'}]),['a','b']);
 assert.deepEqual(requiredSolveIds([{id:'c',stage:'more'}]),[]);
});
