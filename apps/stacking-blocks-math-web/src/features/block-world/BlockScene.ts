import { observedView, type ObservedView } from '../../../shared/problems/contracts/camera.ts';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
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
import type { RewardMaterial } from '../../../shared/rewards.ts';

export interface SceneState {
  inspectable?: boolean;
  blocks: BlockCoord[];
  selected: BlockCoord | null;
  layerMax: number | null;
  layerOnly?: number | null;
  answerGhost?: BlockCoord[];
  highlightedBlocks?: BlockCoord[];
  /** 문제 문구가 참조하는 기준 블록. 항상 뚜렷한 빨간색으로 표시한다 (BLOCK_POSITION 등). */
  referenceBlocks?: BlockCoord[];
  disabled?: boolean;
  allowRotate?: boolean;
  appearance?: Record<string, RewardMaterial>;
}
export interface SceneCallbacks {
  view?: (view: ObservedView) => void;
  frontPosition?: (point:{x:number;y:number}|null)=>void;
  /**
   * Screen-space position of the first referenceBlock, or null when off-screen/behind camera.
   * An HTML overlay (not a WebGL material) so the "기준 블록" marker never depends on whether
   * a material color actually rendered on a given device/browser.
   */
  referencePosition?: (point:{x:number;y:number}|null)=>void;
  change: (blocks: BlockCoord[]) => void;
  select: (block: BlockCoord | null) => void;
  message: (message: string | null) => void;
}

/** Owns GPU resources and pointer listeners. Network and persistence stay outside the engine. */
export class BlockScene {
  private previousFrontPosition = "";
  private previousReferencePosition = "";
  private previousView: ObservedView | null = null;
  private engine: Engine;
  private scene: Scene;
  private camera: ArcRotateCamera;
  private cubes = new Map<string, Mesh>();
  private answers: Mesh[] = [];
  private frontMarker: Mesh[] = [];
  private material: StandardMaterial;
  private blockMaterials = new Map<RewardMaterial, StandardMaterial>();
  private selectedMaterial: StandardMaterial;
  private referenceMaterial: StandardMaterial;
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
    // 넓은 설계판도 첫 화면에서 작업 가능한 영역으로 보이도록 발판 크기에
    // 비례해 프레임을 잡는다. 기존의 1.9배 반경은 10×10 판을 너무 멀리
    // 보여 주어 학생이 유효한 칸을 찾기 어려웠다.
    this.camera = new ArcRotateCamera('camera', -Math.PI / 3, Math.PI / 3, this.frameRadius() * 1.4, new Vector3(grid.gridWidth / 2, grid.maxHeight / 3, grid.gridDepth / 2), this.scene);
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
    this.blockMaterials.set('wood', this.material);
    this.blockMaterials.set('pastel', makeMaterial('pastel', '#e9b8d1'));
    this.blockMaterials.set('brick', makeMaterial('brick', '#c97b68'));
    this.blockMaterials.set('tile', makeMaterial('tile', '#8eb8c9'));
    this.selectedMaterial = makeMaterial('selected', '#5d82c7');
    // index.css --berry token, so "빨간 블록" text and the 3D block agree.
    this.referenceMaterial = makeMaterial('reference', '#c0504d');
    this.ghostMaterial = makeMaterial('placement', '#86d8c0', 0.48);
    this.answerMaterial = makeMaterial('answer', '#6c77d5', 0.28);
    const floorMaterial = makeMaterial('floor', '#cfd8df');
    const tileMaterial = makeMaterial('grid-tile', '#f0ede6');
    const ground = CreateGround('pickable-ground', { width: grid.gridWidth, height: grid.gridDepth }, this.scene);
    // Keep the picking plane below the tiles (tile top is -0.01), so their grid gaps remain visible.
    ground.position.set(grid.gridWidth / 2, -0.02, grid.gridDepth / 2);
    ground.material = floorMaterial;
    ground.metadata = { floor: true };
    for (let z = 0; z < grid.gridDepth; z++) for (let x = 0; x < grid.gridWidth; x++) {
      const tile = CreateBox(`floor-${x}-${z}`, { width: 0.97, depth: 0.97, height: 0.08 }, this.scene);
      tile.position.set(x + 0.5, -0.05, z + 0.5);
      tile.material = tileMaterial;
      tile.isPickable = false;
    }
    // Mark the actual z=0 edge; the text tracks this same world-space edge.
    const frontEdge=CreateLines('front-edge',{points:[new Vector3(0,0.04,-0.03),new Vector3(grid.gridWidth,0.04,-0.03)]},this.scene);
    frontEdge.color=Color3.FromHexString('#4b6680');frontEdge.isPickable=false;this.frontMarker.push(frontEdge);
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
      const rect=this.canvas.getBoundingClientRect();
      const marker=Vector3.Project(new Vector3(this.grid.gridWidth/2,0.08,-0.22),Matrix.Identity(),this.scene.getTransformMatrix(),this.camera.viewport.toGlobal(rect.width,rect.height));
      const point=marker.z>=0&&marker.z<=1&&marker.x>=0&&marker.x<=rect.width&&marker.y>=0&&marker.y<=rect.height?{x:Math.round(marker.x*10)/10,y:Math.round(marker.y*10)/10}:null;
      const positionKey=point?`${point.x},${point.y}`:'hidden';
      if(positionKey!==this.previousFrontPosition){this.previousFrontPosition=positionKey;this.callbacks.frontPosition?.(point);}
      if(this.callbacks.referencePosition){
        const refBlock=this.state.referenceBlocks?.[0];
        let refPoint:{x:number;y:number}|null=null;
        if(refBlock){
          const refMarker=Vector3.Project(new Vector3(refBlock.x+0.5,refBlock.y+0.5,refBlock.z+0.5),Matrix.Identity(),this.scene.getTransformMatrix(),this.camera.viewport.toGlobal(rect.width,rect.height));
          refPoint=refMarker.z>=0&&refMarker.z<=1&&refMarker.x>=0&&refMarker.x<=rect.width&&refMarker.y>=0&&refMarker.y<=rect.height?{x:Math.round(refMarker.x*10)/10,y:Math.round(refMarker.y*10)/10}:null;
        }
        const refKey=refPoint?`${refPoint.x},${refPoint.y}`:'hidden';
        if(refKey!==this.previousReferencePosition){this.previousReferencePosition=refKey;this.callbacks.referencePosition(refPoint);}
      }
      const view = observedView(this.camera.position.subtract(this.camera.target));
      if (view !== this.previousView) { this.previousView = view; this.callbacks.view?.(view); }
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
      const appearance = state.appearance?.[key] ?? 'wood';
      mesh.material = state.referenceBlocks?.some(b => keyOf(b) === key)
        ? this.referenceMaterial
        : (state.selected && keyOf(state.selected) === key) || state.highlightedBlocks?.some(b => keyOf(b) === key)
          ? this.selectedMaterial
          : (this.blockMaterials.get(appearance) ?? this.material);
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
    const alpha = preset === 'back' ? Math.PI / 2 : preset === 'left' ? Math.PI : preset === 'right' || preset === 'side' ? 0 : preset === 'top' || preset === 'front' ? -Math.PI / 2 : -Math.PI / 3;
    const beta = preset === 'top' ? 0.001 : ['front','back','left','right','side'].includes(preset) ? Math.PI / 2 : Math.PI / 3;
    const nearestAlpha = this.camera.alpha + Math.atan2(Math.sin(alpha - this.camera.alpha), Math.cos(alpha - this.camera.alpha));
    this.camera.mode = orthographic && ['top', 'front', 'side', 'back', 'left', 'right'].includes(preset) ? Camera.ORTHOGRAPHIC_CAMERA : Camera.PERSPECTIVE_CAMERA;
    this.cameraTween = { start: performance.now(), alpha: this.camera.alpha, beta: this.camera.beta, radius: this.camera.radius, targetAlpha: nearestAlpha, targetBeta: beta, targetRadius: this.frameRadius() * (preset === 'home' || preset === 'free' ? 1.4 : 1) };
  }

  private frameRadius() {
    const footprint = Math.max(this.grid.gridWidth, this.grid.gridDepth);
    return Math.max(4.8, footprint * 1.2);
  }

  private updateOrtho() {
    if (this.camera.mode !== Camera.ORTHOGRAPHIC_CAMERA) return;
    // 정사영에서도 10×10 바닥 전체가 세로로 잘리지 않도록 여유를 둔다.
    const half = Math.max(2, this.camera.radius * 0.42);
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
    if (event.button !== 0) return;
    if (this.state.disabled) {
      if (this.state.inspectable) { const block=this.pick(event)?.pickedMesh?.metadata?.block as BlockCoord|undefined; if(block)this.callbacks.select(block); }
      return;
    }
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
