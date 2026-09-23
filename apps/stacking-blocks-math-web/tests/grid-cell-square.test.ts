import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Global square-grid fix (see WORKLOG): every grid cell across lesson 1-12
// (number map / height map / layer map / top-front-side projection grids)
// renders through the single shared <ProjectionGrid> component
// (src/components/world/ProjectionGrid.tsx) and its CSS in
// src/styles/index.css. Previously `.projection-table-number td` overrode
// only `height` to 76px while width stayed 48px, stretching number-map
// cells (height map, "숫자 지도") into tall rectangles. These tests assert
// the structural CSS properties a square-cell regression would break,
// via source inspection -- the same pattern already used in this suite
// (see tests/lesson-page-direction-leak.test.ts) since there is no
// jsdom/RTL computed-layout harness in this repo.

async function readCss(): Promise<string> {
  return readFile(new URL("../src/styles/index.css", import.meta.url), "utf8");
}

async function readProjectionGridSource(): Promise<string> {
  return readFile(new URL("../src/components/world/ProjectionGrid.tsx", import.meta.url), "utf8");
}

function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`));
  assert.ok(match, `selector not found: ${selector}`);
  return match![0];
}

test("A. boolean projection cells (.projection-table td / .cell-btn) are always 1:1 square", async () => {
  const css = await readCss();
  const td = block(css, ".projection-table td");
  assert.match(td, /width:\s*var\(--cell-size\)/);
  assert.match(td, /height:\s*var\(--cell-size\)/);
  assert.match(td, /aspect-ratio:\s*1\s*\/\s*1/);
  const btn = block(css, ".cell-btn");
  assert.match(btn, /width:\s*100%/);
  assert.match(btn, /height:\s*100%/);
  assert.match(btn, /aspect-ratio:\s*1\s*\/\s*1/);
});

test("B. a square (equal rows/cols) grid renders as a square overall, since table-layout is fixed and every cell shares one uniform size", async () => {
  const css = await readCss();
  const table = block(css, ".projection-table");
  assert.match(table, /table-layout:\s*fixed/, "fixed layout is required for uniform per-cell sizing to add up to a square table");
});

test("C. non-square (rows != cols) grids still keep each individual cell square -- <td>/<button> never carry an inline size style that could diverge from the shared square CSS by grid shape", async () => {
  const source = await readProjectionGridSource();
  // Every <td>/<button> in the table is rendered with only `key`/`aria-*`/`className`/handlers --
  // no `style={...}` sizing that could vary by rowCount/colCount and break the uniform square rule.
  const tableBlock = source.match(/const table = <table[\s\S]*?<\/table>;/)?.[0];
  assert.ok(tableBlock, "the projection table JSX must exist");
  assert.doesNotMatch(tableBlock!, /<td[^>]*style=/, "a <td> must not carry an inline size style");
  assert.doesNotMatch(tableBlock!, /<button[^>]*style=/, "a cell <button> must not carry an inline size style");
});

test("D. number-map cells: a dedicated square wrapper (.number-cell) owns the box size, not the <td> -- an HTML table row grows to fit its tallest cell's intrinsic content, so aspect-ratio/height on <td> alone does not reliably hold a 3-stacked-element cell square (confirmed live: computed width==height==64 across three viewports only after this fix)", async () => {
  const css = await readCss();
  const numberTd = block(css, ".projection-table-number td");
  assert.doesNotMatch(numberTd, /height:\s*76px/, "the old height-only override that produced a tall rectangle must be gone");
  assert.doesNotMatch(numberTd, /\bheight:/, "the <td> must not set its own height -- that's the wrapper's job now, since <td> height is only a minimum a table row can still grow past");
  assert.match(numberTd, /width:\s*var\(--cell-size-number\)/);
  const numberCell = block(css, ".number-cell");
  assert.match(numberCell, /width:\s*var\(--cell-size-number\)/, "explicit width, not 100% of a <td> whose own height is unreliable");
  assert.match(numberCell, /height:\s*var\(--cell-size-number\)/, "explicit height (not aspect-ratio alone) is what actually resists content-driven growth");
  assert.match(numberCell, /overflow:\s*hidden/, "content that still wants to be taller must clip, never grow the box");
});

test("D2. the -/+ steppers and value are CSS-grid rows that fill the fixed-size wrapper, never push it taller", async () => {
  const css = await readCss();
  const numberCell = block(css, ".number-cell");
  assert.match(numberCell, /display:\s*grid/);
  assert.match(numberCell, /grid-template-rows:\s*1fr\s+1fr\s+1fr/, "three equal rows (-, value, +) inside the fixed-height wrapper");
  const step = block(css, ".number-cell-step");
  assert.match(step, /height:\s*100%/);
  assert.match(step, /min-height:\s*0/, "must be free to shrink to its 1fr row, not resist via an intrinsic button min-height");
  assert.doesNotMatch(step, /min-height:\s*26px/, "the old fixed 26px stepper height (part of the original 76px total) must be gone");
  const value = block(css, ".number-cell-value");
  assert.match(value, /min-height:\s*0/);
  assert.match(value, /overflow:\s*hidden/);
});

test("E. cell sizes shrink on small viewports via clamp()/vw while staying capped for large screens", async () => {
  const css = await readCss();
  const root = block(css, ":root");
  assert.match(root, /--cell-size:\s*clamp\([^)]*vw[^)]*\)/);
  assert.match(root, /--cell-size-number:\s*clamp\([^)]*vw[^)]*\)/);
});

test("F/G. front/side direction labels stay in their own reserved padding and never sit on top of grid cells", async () => {
  const css = await readCss();
  const frame = block(css, ".projection-frame");
  assert.match(frame, /padding:\s*0\s+\d+px\s+\d+px\s+0/, "labels need dedicated padding outside the cell area so they cannot overlap grid content");
  const label = block(css, ".projection-label");
  assert.match(label, /position:\s*absolute/);
  assert.match(label, /pointer-events:\s*none/, "labels must not intercept clicks meant for grid cells");
});

test("H. grading/coordinate logic in ProjectionGrid is untouched by the CSS-only fix", async () => {
  const source = await readProjectionGridSource();
  assert.match(source, /const handleToggle = \(r: number, c: number\) => \{/);
  assert.match(source, /const stepNumber = \(r: number, c: number, delta: 1 \| -1\) => \{/);
  assert.match(source, /next\[r\]\[c\] = Math\.max\(0, Math\.min\(9, value \+ delta\)\);/);
});
