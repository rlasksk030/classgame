import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// No canvas/WebGL test harness exists for the Babylon.js scene in this repo,
// so these assert the exact structural properties requested: a "옆" (side)
// reference label mirroring the existing "앞" (front) one, at the +x edge
// (matching the app's fixed axis convention: +x = right/side, -z = front --
// see shared/spatialConventions.ts and shared/problems/contracts/camera.ts),
// so the two never overlap and the camera preset that shares "옆"'s viewing
// angle is the same one used for the 2D projection's right-side convention.

async function readBlockSceneSource(): Promise<string> {
  return readFile(new URL("../src/features/block-world/BlockScene.ts", import.meta.url), "utf8");
}

async function readBlockWorldSource(): Promise<string> {
  return readFile(new URL("../src/components/world/BlockWorld.tsx", import.meta.url), "utf8");
}

test("BlockScene tracks a side (+x edge) marker in parallel with the existing front (-z edge) marker", async () => {
  const source = await readBlockSceneSource();
  assert.match(source, /sidePosition\?:\s*\(point:\{x:number;y:number\}\|null\)=>void;/, "SceneCallbacks must declare sidePosition alongside frontPosition");
  assert.match(source, /private previousSidePosition = "";/);
  assert.match(source, /private sideMarker: Mesh\[\] = \[\];/);
  const sideEdge = source.match(/const sideEdge=CreateLines\('side-edge',\{points:\[[\s\S]{0,200}/)?.[0];
  assert.ok(sideEdge, "a side-edge line mesh must exist");
  // +x = right/side per the app's fixed axis convention; must not reuse the
  // front edge's z=-0.03 plane (that would place both edges on the same
  // side and either overlap or point in the same direction).
  assert.match(sideEdge!, /grid\.gridWidth\+0\.03/);
});

test("BlockScene's render loop projects and fires the side marker's screen position every frame, independent of the front marker", async () => {
  const source = await readBlockSceneSource();
  const loopSection = source.match(/const marker=Vector3\.Project\([\s\S]{0,1400}/)?.[0];
  assert.ok(loopSection, "the front-marker projection block must exist");
  assert.match(loopSection!, /const sideMarkerPoint=Vector3\.Project\(new Vector3\(this\.grid\.gridWidth\+0\.22,0\.08,this\.grid\.gridDepth\/2\)/);
  assert.match(loopSection!, /this\.callbacks\.sidePosition\?\.\(sidePoint\);/);
});

test("the 'side' and 'right' camera presets share the same viewing angle, so the 옆 label's +x edge matches what 옆(오른쪽) actually shows", async () => {
  const source = await readBlockSceneSource();
  const setViewAlpha = source.match(/const alpha = [^;]+;/)?.[0];
  assert.ok(setViewAlpha, "setView's alpha computation must exist");
  assert.match(setViewAlpha!, /preset === 'right' \|\| preset === 'side' \? 0/, "'side' must resolve to the same alpha as 'right', not a different/ambiguous angle");
});

test("BlockWorld renders both 앞 and 옆 overlay labels, wired to their own independent scene callbacks", async () => {
  const source = await readBlockWorldSource();
  assert.match(source, /const sideLabel = useRef<HTMLDivElement>\(null\);/);
  const callbackWiring = source.match(/frontPosition: position => \{[\s\S]{0,500}/)?.[0];
  assert.ok(callbackWiring, "the frontPosition callback wiring must exist");
  assert.match(callbackWiring!, /sidePosition: position => \{/);
  assert.match(callbackWiring!, /const label=sideLabel\.current;/);
  assert.match(source, /<div ref=\{frontLabel\} className="front-direction-label" aria-label="작업판 앞"[^>]*>앞<\/div>/);
  assert.match(source, /<div ref=\{sideLabel\} className="front-direction-label" aria-label="작업판 옆"[^>]*>옆<\/div>/);
});
