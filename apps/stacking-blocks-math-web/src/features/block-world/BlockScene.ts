import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Culling/ray';
import { canonicalize, columnHeight, moveBlock, placeOnColumn, canRemove, keyOf } from '../../../shared/blocks.ts';
import type { BlockCoord, GridConfig, ViewPreset } from '../../../shared/types.ts';

export interface SceneState {
  blocks: BlockCoord[];
  selected: BlockCoord | null;
  layerMax: number | null;
  layerOnly?: number | null;
  answerGhost?: BlockCoord[];
  disabled?: boolean;
  allowRotate?: boolean;
}
export interface SceneCallbacks {
  change: (blocks: BlockCoord[]) => void;
  select: (block: BlockCoord | null) => void;
  message: (message: string | null) => void;
}

/** Owns GPU resources and pointer listeners. Network and persistence stay outside the engine. */
export class BlockScene {
  private engine: Engine;
  private scene: Scene;
  private camera: ArcRotateCamera;
  private cubes = new Map<string, Mesh>();
  private answers: Mesh[] = [];
  private frontMarker: Mesh[] = [];
  private material: StandardMaterial;
  private selectedMaterial: StandardMaterial;
  private ghostMaterial: StandardMaterial;
  private answerMaterial: StandardMaterial;
  private ghost: Mesh;
  private state: SceneState = { blocks: [], selected: null, layerMax: null };
  private resize: ResizeObserver;
  private drag: { id: number; from: BlockCoord | null; startX: number; startY: number; moved: boolean } | null = null;
  private candidate: { x: number; z: number } | null = null;
  private paletteArmed = false;
  private cameraTween: { start: number; alpha: number; beta: number; radius: number; targetAlpha: number; targetBeta: number; targetRadius: number } | null = null;
  private pointers = new Set<number>();

  constructor(private canvas: HTMLCanvasElement, private grid: GridConfig, private callbacks: SceneCallbacks) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false });
    this.engine.setHardwareScalingLevel(Math.max(1, window.devicePixelRatio / 1.5));
    this.scene = new Scene(this.engine);
    this.scene.clearColor = Color4.FromHexString('#f4f7faff');
    const size = Math.max(grid.gridWidth, grid.gridDepth, grid.maxHeight);
    this.camera = new ArcRotateCamera('camera', -Math.PI / 3, Math.PI / 3, size * 1.9, new Vector3(grid.gridWidth / 2, grid.maxHeight / 3, grid.gridDepth / 2), this.scene);
    this.camera.lowerRadiusLimit = 2;
    this.camera.upperRadiusLimit = size * 5;
    this.camera.lowerBetaLimit = 0.001;
    this.camera.upperBetaLimit = Math.PI / 2;
    this.camera.panningSensibility = 0;
    this.camera.wheelDeltaPercentage = 0.015;
    this.camera.pinchDeltaPercentage = 0.01;
    // Capture listeners run before Babylon's orbit input, so grabbing blocks cannot rotate the camera.
    canvas.addEventListener('pointerdown', this.down, true);
    window.addEventListener('pointermove', this.move, true);
    window.addEventListener('pointerup', this.up, true);
    window.addEventListener('pointercancel', this.cancel, true);
    window.addEventListener('blur', this.blur);
    this.camera.attachControl(canvas, true);
    new HemisphericLight('light', new Vector3(-0.4, 1, -0.6), this.scene).intensity = 1.1;
    const makeMaterial = (name: string, color: string, alpha = 1) => {
      const m = new StandardMaterial(name, this.scene);
      m.diffuseColor = Color3.FromHexString(color);
      m.specularColor = Color3.Black();
      m.alpha = alpha;
      return m;
    };
    this.material = makeMaterial('wood', '#d8b07a');
    this.selectedMaterial = makeMaterial('selected', '#5d82c7');
    this.ghostMaterial = makeMaterial('placement', '#86d8c0', 0.48);
    this.answerMaterial = makeMaterial('answer', '#6c77d5', 0.28);
    const floorMaterial = makeMaterial('floor', '#cfd8df');
    const tileMaterial = makeMaterial('grid-tile', '#f0ede6');
    const ground = CreateGround('pickable-ground', { width: grid.gridWidth, height: grid.gridDepth }, this.scene);
    ground.position.set(grid.gridWidth / 2, -0.005, grid.gridDepth / 2);
    ground.material = floorMaterial;
    ground.metadata = { floor: true };
    for (let z = 0; z < grid.gridDepth; z++) for (let x = 0; x < grid.gridWidth; x++) {
      const tile = CreateBox(`floor-${x}-${z}`, { width: 0.97, depth: 0.97, height: 0.08 }, this.scene);
      tile.position.set(x + 0.5, -0.05, z + 0.5);
      tile.material = tileMaterial;
      tile.isPickable = false;
    }
    // 좌표의 앞(z=0)을 카메라가 회전해도 알아볼 수 있도록 작업판에 표시한다.
    const markerColor = Color3.FromHexString('#4b6680');
    const markerZ = -0.28;
    const markerY = 0.04;
    const markerX = grid.gridWidth / 2;
    const shaft = CreateLines('front-direction-shaft', {
      points: [new Vector3(markerX, markerY, 0.75), new Vector3(markerX, markerY, markerZ)],
    }, this.scene);
    shaft.color = markerColor;
    shaft.isPickable = false;
    const tips: Array<[string, Vector3[]]> = [
      ['front-direction-tip-a', [new Vector3(markerX, markerY, markerZ), new Vector3(markerX - 0.18, markerY, markerZ + 0.2)]],
      ['front-direction-tip-b', [new Vector3(markerX, markerY, markerZ), new Vector3(markerX + 0.18, markerY, markerZ + 0.2)]],
    ];
    for (const [name, points] of tips) {
      const line = CreateLines(name, { points }, this.scene);
      line.color = markerColor;
      line.isPickable = false;
      this.frontMarker.push(line);
    }
    this.frontMarker.push(shaft);
    this.ghost = CreateBox('placement-preview', { size: 0.96 }, this.scene);
    this.ghost.material = this.ghostMaterial;
    this.ghost.isPickable = false;
    this.ghost.setEnabled(false);
    this.resize = new ResizeObserver(() => { this.engine.resize(); this.updateOrtho(); });
    this.resize.observe(canvas);
    this.engine.runRenderLoop(() => {
      const tween = this.cameraTween;
      if (tween) {
        const t = Math.min(1, (performance.now() - tween.start) / 320);
        const eased = t * t * (3 - 2 * t);
        this.camera.alpha = tween.alpha + (tween.targetAlpha - tween.alpha) * eased;
        this.camera.beta = tween.beta + (tween.targetBeta - tween.beta) * eased;
        this.camera.radius = tween.radius + (tween.targetRadius - tween.radius) * eased;
        if (t === 1) this.cameraTween = null;
      }
      this.updateOrtho();
      this.scene.render();
    });
  }

  update(state: SceneState) {
    this.state = state;
    if (state.allowRotate === false) this.camera.detachControl();
    else if (!this.drag) this.camera.attachControl(this.canvas, true);
    const keys = new Set(state.blocks.map(keyOf));
    for (const [key, mesh] of this.cubes) if (!keys.has(key)) { mesh.dispose(); this.cubes.delete(key); }
    for (const block of state.blocks) {
      const key = keyOf(block);
      let mesh = this.cubes.get(key);
      if (!mesh) {
        mesh = CreateBox(key, { size: 0.96 }, this.scene);
        mesh.position.set(block.x + 0.5, block.y + 0.5, block.z + 0.5);
        mesh.metadata = { block };
        this.cubes.set(key, mesh);
      }
      mesh.material = state.selected && keyOf(state.selected) === key ? this.selectedMaterial : this.material;
      mesh.setEnabled(this.visible(block));
    }
    this.answers.forEach(mesh => mesh.dispose());
    this.answers = (state.answerGhost ?? []).map(block => {
      const mesh = CreateBox('answer', { size: 0.99 }, this.scene);
      mesh.position.set(block.x + 0.5, block.y + 0.5, block.z + 0.5);
      mesh.material = this.answerMaterial;
      mesh.isPickable = false;
      mesh.setEnabled(this.visible(block));
      return mesh;
    });
  }

  private visible(block: BlockCoord) {
    return (this.state.layerMax == null || block.y < this.state.layerMax) && (this.state.layerOnly == null || block.y === this.state.layerOnly - 1);
  }

  setView(preset: ViewPreset, orthographic = false) {
    const alpha = preset === 'side' ? 0 : preset === 'top' || preset === 'front' ? -Math.PI / 2 : -Math.PI / 3;
    const beta = preset === 'top' ? 0.001 : preset === 'front' || preset === 'side' ? Math.PI / 2 : Math.PI / 3;
    const nearestAlpha = this.camera.alpha + Math.atan2(Math.sin(alpha - this.camera.alpha), Math.cos(alpha - this.camera.alpha));
    this.camera.mode = orthographic && ['top', 'front', 'side'].includes(preset) ? Camera.ORTHOGRAPHIC_CAMERA : Camera.PERSPECTIVE_CAMERA;
    this.cameraTween = { start: performance.now(), alpha: this.camera.alpha, beta: this.camera.beta, radius: this.camera.radius, targetAlpha: nearestAlpha, targetBeta: beta, targetRadius: Math.max(this.grid.gridWidth, this.grid.gridDepth, this.grid.maxHeight) * 2.4 };
  }

  private updateOrtho() {
    if (this.camera.mode !== Camera.ORTHOGRAPHIC_CAMERA) return;
    const half = this.camera.radius * 0.3;
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    this.camera.orthoLeft = -half * aspect; this.camera.orthoRight = half * aspect;
    this.camera.orthoTop = half; this.camera.orthoBottom = -half;
  }

  private pick(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
    return this.scene.pick(event.clientX - rect.left, event.clientY - rect.top, mesh => mesh.isEnabled() && (mesh.metadata?.floor || mesh.metadata?.block) && (!this.drag?.from || keyOf(mesh.metadata?.block ?? { x: -1, y: -1, z: -1 }) !== keyOf(this.drag.from)));
  }

  beginPalette(event: PointerEvent) {
    if (this.state.disabled) return;
    this.finish();
    this.paletteArmed = false;
    this.startDrag(event, null);
  }

  armPalette() {
    if (this.state.disabled) return;
    this.finish();
    this.paletteArmed = true;
    this.callbacks.message('쌓기나무를 선택했어요. 작업판을 눌러 놓아 보세요.');
  }

  private startDrag(event: PointerEvent, from: BlockCoord | null) {
    this.cameraTween = null;
    this.camera.detachControl();
    this.drag = { id: event.pointerId, from, startX: event.clientX, startY: event.clientY, moved: from !== null };
    this.callbacks.select(from);
    event.preventDefault();
  }

  private down = (event: PointerEvent) => {
    this.pointers.add(event.pointerId);
    this.cameraTween = null;
    if (this.pointers.size > 1) { this.paletteArmed = false; this.finish(); return; }
    if (this.state.disabled || event.button !== 0) return;
    const picked = this.pick(event);
    const block = picked?.pickedMesh?.metadata?.block as BlockCoord | undefined;
    if (this.paletteArmed && picked) {
      event.stopImmediatePropagation();
      this.paletteArmed = false;
      this.startDrag(event, null);
      if (!this.drag) return;
      this.drag.moved = true;
      this.updateCandidate(picked);
      return;
    }
    this.paletteArmed = false;
    if (block) {
      event.stopImmediatePropagation();
      this.callbacks.select(block);
      const check = canRemove(this.state.blocks, block);
      if (!check.ok) { this.callbacks.message(check.message ?? null); return; }
      this.startDrag(event, block);
    }
  };

  private move = (event: PointerEvent) => {
    if (!this.drag || this.drag.id !== event.pointerId) return;
    event.preventDefault();
    if (Math.hypot(event.clientX - this.drag.startX, event.clientY - this.drag.startY) > 5) this.drag.moved = true;
    const picked = this.pick(event);
    if (!picked || !this.drag.moved) { this.candidate = null; this.ghost.setEnabled(false); return; }
    this.updateCandidate(picked);
  };

  private updateCandidate(picked: ReturnType<Scene['pick']>) {
    const point = picked?.pickedPoint;
    if (!point) return;
    const block = picked?.pickedMesh?.metadata?.block as BlockCoord | undefined;
    const x = block?.x ?? Math.floor(point.x), z = block?.z ?? Math.floor(point.z);
    this.candidate = { x, z };
    const result = this.result(x, z);
    const base = this.drag?.from ? this.state.blocks.filter(b => keyOf(b) !== keyOf(this.drag!.from!)) : this.state.blocks;
    this.ghost.position.set(x + 0.5, columnHeight(base, x, z) + 0.5, z + 0.5);
    this.ghostMaterial.diffuseColor = Color3.FromHexString(result.check.ok ? '#86d8c0' : '#ef8f84');
    this.ghost.setEnabled(true);
    this.callbacks.message(result.check.ok ? '놓을 수 있어요.' : result.check.message ?? '여기에는 놓을 수 없어요.');
  }

  private result(x: number, z: number) {
    return this.drag?.from ? moveBlock(this.state.blocks, this.drag.from, x, z, this.grid) : placeOnColumn(this.state.blocks, x, z, this.grid);
  }

  private up = (event: PointerEvent) => {
    this.pointers.delete(event.pointerId);
    if (!this.drag || this.drag.id !== event.pointerId) return;
    if (this.candidate && this.drag.moved) {
      const result = this.result(this.candidate.x, this.candidate.z);
      if (result.check.ok) { this.callbacks.change(canonicalize(result.blocks)); this.callbacks.select(null); this.callbacks.message('쌓기나무를 놓았어요.'); }
    } else if (this.drag.from === null && !this.drag.moved) {
      this.paletteArmed = true;
      this.callbacks.message('쌓기나무를 선택했어요. 작업판을 눌러 놓아 보세요.');
    }
    this.finish();
  };
  private cancel = (event: PointerEvent) => { this.pointers.delete(event.pointerId); if (this.drag?.id === event.pointerId) this.finish(); };
  private blur = () => { this.pointers.clear(); this.finish(); };
  private finish() { this.drag = null; this.candidate = null; this.ghost?.setEnabled(false); if (this.state.allowRotate !== false) this.camera.attachControl(this.canvas, true); }

  dispose() {
    this.resize.disconnect();
    this.canvas.removeEventListener('pointerdown', this.down, true);
    window.removeEventListener('pointermove', this.move, true);
    window.removeEventListener('pointerup', this.up, true);
    window.removeEventListener('pointercancel', this.cancel, true);
    window.removeEventListener('blur', this.blur);
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}
