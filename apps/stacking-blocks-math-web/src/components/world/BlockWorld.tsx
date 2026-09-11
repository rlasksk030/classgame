import { useEffect, useRef, useState } from 'react';
import { BlockScene, type SceneState } from '../../features/block-world/BlockScene';
import { canonicalize, placeOnColumn, moveBlock, removeBlock } from '@shared/blocks.ts';
import { VIEW_PRESET_LABELS, type BlockCoord, type GridConfig, type ViewPreset } from '@shared/types.ts';

interface WorldProps extends SceneState {
  grid: GridConfig;
  onBlocksChange: (next: BlockCoord[]) => void;
  onSelect: (next: BlockCoord | null) => void;
  onMessage: (message: string | null) => void;
  onSnapshotChange?: (next: BlockCoord[]) => void;
  onPreset?: (next: ViewPreset) => void;
  preset: ViewPreset;
}

export default function BlockWorld(props: WorldProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<BlockScene | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState('');
  const [orthographic, setOrthographic] = useState(true);
  const [layerOnly, setLayerOnly] = useState<number | null>(null);
  const [cellX, setCellX] = useState(0), [cellZ, setCellZ] = useState(0);
  const commit = (blocks: BlockCoord[]) => {
    const next = canonicalize(blocks);
    latest.current.onBlocksChange(next);
    latest.current.onSnapshotChange?.(next);
  };
  useEffect(() => {
    if (!canvas.current) return;
    let world: BlockScene | undefined;
    try {
      world = new BlockScene(canvas.current, props.grid, {
        change: commit,
        select: block => latest.current.onSelect(block),
        message: message => latest.current.onMessage(message),
      });
      scene.current = world;
      world.update(latest.current);
      world.setView(latest.current.preset, orthographic);
      setError('');
    } catch {
      world?.dispose();
      setError('3D 화면을 열 수 없어요. 브라우저의 하드웨어 가속을 켠 뒤 다시 접속해 주세요.');
    }
    return () => { world?.dispose(); scene.current = null; };
  }, [props.grid.gridWidth, props.grid.gridDepth, props.grid.maxHeight]);
  useEffect(() => { scene.current?.update({ ...props, layerOnly }); }, [props.blocks, props.selected, props.layerMax, props.answerGhost, props.disabled, props.allowRotate, layerOnly]);
  useEffect(() => { scene.current?.setView(props.preset, orthographic); }, [props.preset, orthographic]);

  const place = () => {
    const result = props.selected ? moveBlock(props.blocks, props.selected, cellX, cellZ, props.grid) : placeOnColumn(props.blocks, cellX, cellZ, props.grid);
    if (result.check.ok) { commit(result.blocks); props.onSelect(null); }
    props.onMessage(result.check.message ?? '쌓기나무를 놓았어요.');
  };
  return <div className="world-wrap">
    <div className="world-toolbar toolbar-row">
      {(Object.keys(VIEW_PRESET_LABELS) as ViewPreset[]).map(preset => <button type="button" className="btn btn-sm" disabled={props.allowRotate === false} key={preset} onClick={() => { props.onPreset?.(preset); scene.current?.setView(preset, orthographic); }}>{VIEW_PRESET_LABELS[preset]}</button>)}
      <label><input type="checkbox" disabled={props.allowRotate === false} checked={orthographic} onChange={e => setOrthographic(e.target.checked)} /> 정확한 투영 보기</label>
      <select disabled={props.allowRotate === false} aria-label="현재 층만 보기" value={layerOnly ?? ''} onChange={e => setLayerOnly(e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">모든 층</option>
        {Array.from({ length: props.grid.maxHeight }, (_, i) => <option key={i} value={i + 1}>{i + 1}층만 보기</option>)}
      </select>
    </div>
    {error ? <p role="alert">{error}</p> : null}
    <canvas ref={canvas} className="world-canvas" aria-label="쌓기나무 3D 작업판" tabIndex={0} style={{ width: '100%', height: 'clamp(280px, 48vh, 500px)', display: 'block', touchAction: 'none' }} />
    {!props.disabled && <div className="toolbar-row" style={{ padding: 10, flexWrap: 'wrap' }}>
      <button type="button" className="btn btn-primary" style={{ touchAction: 'none' }} onPointerDown={e => scene.current?.beginPalette(e.nativeEvent)}>🧱 잡아서 작업판에 놓기</button>
      <button type="button" className="btn" disabled={!props.selected} onClick={() => {
        if (!props.selected) return;
        const result = removeBlock(props.blocks, props.selected);
        if (result.check.ok) { commit(result.blocks); props.onSelect(null); }
        props.onMessage(result.check.message ?? '쌓기나무를 지웠어요.');
      }}>선택 블록 삭제</button>
      <details><summary>버튼으로 놓기</summary>
        <label>가로 <input type="number" min={1} max={props.grid.gridWidth} value={cellX + 1} onChange={e => setCellX(Number(e.target.value) - 1)} /></label>
        <label>세로 <input type="number" min={1} max={props.grid.gridDepth} value={cellZ + 1} onChange={e => setCellZ(Number(e.target.value) - 1)} /></label>
        <button type="button" className="btn" onClick={place}>{props.selected ? '선택 블록 옮기기' : '쌓기'}</button>
      </details>
    </div>}
    <p className="muted" style={{ padding: '0 12px' }}>빈 곳을 끌면 회전 · 두 손가락이나 휠로 확대 · 블록을 잡으면 이동</p>
  </div>;
}
