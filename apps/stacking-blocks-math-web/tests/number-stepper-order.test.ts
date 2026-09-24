import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Number-map/height-map stepper button order (숫자 지도, 높이 지도, and every
// other numeric grid cell across lessons 1-12 share this one component:
// src/components/world/ProjectionGrid.tsx). Was [-, value, +] (top to
// bottom); changed to [+, value, -] so the top button always increases and
// the bottom button always decreases, matching the up=more/down=less
// convention. Click handlers, delta values, and bounds are unchanged --
// only the DOM order (and therefore visual stacking order, since
// .number-cell is `display: grid` with no explicit grid-row/order on
// children, so children stack in document order) moved.
//
// No jsdom/RTL harness in this repo (see tests/grid-cell-square.test.ts for
// the same source-inspection pattern used here).

async function readSource(): Promise<string> {
  return readFile(new URL("../src/components/world/ProjectionGrid.tsx", import.meta.url), "utf8");
}

function numberCellBlock(source: string): string {
  const match = source.match(/<div className="number-cell">[\s\S]*?<\/div>/);
  assert.ok(match, "number-cell wrapper not found");
  return match![0];
}

test("1/3. the top button is + (increase) and the bottom button is - (decrease), in DOM order", async () => {
  const block = numberCellBlock(await readSource());
  const buttons = [...block.matchAll(/<button[\s\S]*?<\/button>/g)].map((m) => m[0]);
  assert.equal(buttons.length, 2, "exactly two stepper buttons per cell");
  assert.match(buttons[0], />\s*＋\s*</, "first (top) button must render +");
  assert.match(buttons[0], /증가/, "first button's aria-label must say 증가 (increase)");
  assert.match(buttons[1], />\s*－\s*</, "second (bottom) button must render -");
  assert.match(buttons[1], /감소/, "second button's aria-label must say 감소 (decrease)");
});

test("2. the value sits between the two buttons in DOM order", async () => {
  const block = numberCellBlock(await readSource());
  const plusIndex = block.indexOf("＋");
  const valueIndex = block.indexOf("number-cell-value");
  const minusIndex = block.indexOf("－");
  assert.ok(plusIndex > -1 && valueIndex > -1 && minusIndex > -1);
  assert.ok(plusIndex < valueIndex && valueIndex < minusIndex, "order must be +, value, - top to bottom");
});

test("4/5. clicking + still calls stepNumber(r, c, 1) and clicking - still calls stepNumber(r, c, -1) -- only order changed, not the delta wiring", async () => {
  const block = numberCellBlock(await readSource());
  const buttons = [...block.matchAll(/<button[\s\S]*?<\/button>/g)].map((m) => m[0]);
  assert.match(buttons[0], /onClick=\{\(\) => stepNumber\(r, c, 1\)\}/, "top (+) button still increments");
  assert.match(buttons[1], /onClick=\{\(\) => stepNumber\(r, c, -1\)\}/, "bottom (-) button still decrements");
});

test("6/7. min/max bounds and disabled-state wiring are unchanged: + disables at >=9, - disables at <=0, and the underlying clamp is still 0..9", async () => {
  const source = await readSource();
  const block = numberCellBlock(source);
  const buttons = [...block.matchAll(/<button[\s\S]*?<\/button>/g)].map((m) => m[0]);
  assert.match(buttons[0], /disabled=\{!editable \|\| value >= 9\}/, "top (+) button disables at the max");
  assert.match(buttons[1], /disabled=\{!editable \|\| value <= 0\}/, "bottom (-) button disables at the min");
  assert.match(source, /next\[r\]\[c\] = Math\.max\(0, Math\.min\(9, value \+ delta\)\);/, "clamp logic itself untouched");
});

test("8. square-cell layout is unaffected -- this fix reordered JSX only, no CSS/sizing change (full regression coverage already in tests/grid-cell-square.test.ts)", async () => {
  const css = await readFile(new URL("../src/styles/index.css", import.meta.url), "utf8");
  const numberCellRule = css.match(/\.number-cell\s*\{[^}]*\}/)?.[0];
  assert.ok(numberCellRule);
  assert.match(numberCellRule!, /display:\s*grid/);
  assert.match(numberCellRule!, /grid-template-rows:\s*1fr\s+1fr\s+1fr/, "still three equal rows -- reordering children doesn't change the fixed square wrapper");
  assert.match(numberCellRule!, /width:\s*var\(--cell-size-number\)/);
  assert.match(numberCellRule!, /height:\s*var\(--cell-size-number\)/);
});
