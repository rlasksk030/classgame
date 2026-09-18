import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBrochureSvg, pdfFromJpeg, summarizeExportLayers } from '../shared/phase4Export.ts';

const grid = [[true, false], [false, true]];
const snapshot = { projectId: 'project-1', projectVersion: 4, title: '별빛 학교', studentName: '학생 A', blocks: [{ x: 0, y: 0, z: 0 }], top: grid, front: grid, side: grid, heightMap: [[1, 0], [0, 1]], layers: [{ level: 1, cells: grid, note: '전시실' }, { level: 2, cells: grid, note: '전시실' }, { level: 3, cells: [[true, false], [false, false]], note: '휴식 공간' }], reason: '모두가 쉬는 공간', description: '작은 건축물' };

test('brochure SVG includes title, student, directions and high-rise summary data', () => {
  const svg = buildBrochureSvg(snapshot);
  assert.match(svg, /별빛 학교/);
  assert.match(svg, /학생 A/);
  assert.match(svg, /옆\(오른쪽\)/);
  assert.match(svg, /1~2층/);
});

test('brochure layer grouping requires both shape and note', () => {
  const grouped = summarizeExportLayers(snapshot.layers);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].label, '1~2층');
  assert.equal(grouped[1].label, '3층');
});

test('single-page PDF writer emits a non-empty PDF with one page', () => {
  const pdf = pdfFromJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 2, 2);
  assert.ok(pdf.length > 100);
  const text = new TextDecoder().decode(pdf);
  assert.match(text, /\/Count 1/);
  assert.match(text, /\/Type \/Page/);
  assert.match(text, /startxref/);
});

test('brochure output contains only intended student-facing fields', () => {
  const svg = buildBrochureSvg(snapshot);
  assert.doesNotMatch(svg, /PIN|token|secret|service_role|password/i);
  assert.match(svg, /별빛 학교/);
  assert.match(svg, /학생 A/);
});
