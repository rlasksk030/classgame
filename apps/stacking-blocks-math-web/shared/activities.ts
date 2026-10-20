import { canonicalize, project, toHeightMap, toLayers, validStructure } from './blocks.ts';
import type { BlockCoord } from './types.ts';
import type { RewardMaterial, RewardTheme } from './rewards.ts';
export const ACTIVITY_GRID = {gridWidth:5,gridDepth:5,maxHeight:3};
/** 건축 프로젝트 전용 기본 작업판. 일반 문제/친구 문제 작업판과 분리한다. */
export const ARCHITECTURE_GRID = {gridWidth:10,gridDepth:10,maxHeight:10};
export type ChallengeType = 'views'|'top'|'heightMap'|'layers';
export interface Building { building_name:string;reason:string;description:string;layer_notes:string[];blocks:BlockCoord[];version:number;submitted:boolean;grid_width?:number;grid_depth?:number;max_height?:number; block_appearance?:Record<string,RewardMaterial>; intro_theme?:RewardTheme; updated_at?:string }
export const EMPTY_BUILDING:Building={building_name:'',reason:'',description:'',layer_notes:Array(10).fill(''),blocks:[],version:0,submitted:false,grid_width:ARCHITECTURE_GRID.gridWidth,grid_depth:ARCHITECTURE_GRID.gridDepth,max_height:ARCHITECTURE_GRID.maxHeight,block_appearance:{},intro_theme:'blueprint'};
/** Existing notes and coordinates are retained; unused floors need no description. */
export function normalizeBuilding(value: Building, maxHeight = 10): Building {
  const size = value.blocks.some(b => b.x >= 5 || b.z >= 5) ? 10 : 5;
  return { ...value, grid_width: value.grid_width ?? size, grid_depth: value.grid_depth ?? size,
    max_height: Math.max(value.max_height ?? 3, maxHeight),
    layer_notes: Array.from({length:Math.max(value.layer_notes.length,maxHeight)},(_,i)=>value.layer_notes[i] ?? '') };
}
export function usedFloors(value: Building): number[] { return [...new Set(value.blocks.map(b=>b.y))].sort((a,b)=>a-b); }
export function validBuilding(value: Building, complete = false) {
  if (!value || !Array.isArray(value.layer_notes) || !Array.isArray(value.blocks)) return false;
  const grid = {gridWidth:value.grid_width ?? 10,gridDepth:value.grid_depth ?? 10,maxHeight:value.max_height ?? 3};
  if (![grid.gridWidth,grid.gridDepth].every(n=>Number.isInteger(n)&&n>=4&&n<=10) || !Number.isInteger(grid.maxHeight) || grid.maxHeight<1 || grid.maxHeight>10) return false;
  if (value.blocks.length>1000 || !validStructure(value.blocks,grid) || canonicalize(value.blocks).length !== value.blocks.length) return false;
  if (value.layer_notes.length<3 || value.layer_notes.length>10 || ![value.building_name,value.reason,value.description,...value.layer_notes].every(s=>typeof s==='string'&&s.length<=2000)) return false;
  return !complete || ([value.building_name,value.reason,value.description].every(s=>s.trim()) && value.blocks.length>0 && usedFloors(value).every(f=>value.layer_notes[f]?.trim()));
}
/** Compare the persisted contract, excluding timestamps and local UI metadata. */
export function buildingContent(value: Building): string {
  const appearance = Object.fromEntries(Object.entries(value.block_appearance ?? {}).sort(([a],[b])=>a.localeCompare(b)));
  return JSON.stringify([value.building_name,value.reason,value.description,value.layer_notes,canonicalize(value.blocks),value.grid_width,value.grid_depth,value.max_height,appearance,value.intro_theme ?? 'blueprint',value.submitted]);
}
export function challengeGiven(blocks:BlockCoord[],type:ChallengeType) {
  if (type === 'heightMap') return {heightMap:toHeightMap(blocks,ACTIVITY_GRID)};
  if (type === 'layers') return {layers:toLayers(blocks,ACTIVITY_GRID)};
  if (type === 'top') return {projections:{top:project(blocks,ACTIVITY_GRID).top}};
  return {projections:project(blocks,ACTIVITY_GRID)};
}
export function validChallenge(blocks:BlockCoord[],type:string) { return ['views','top','heightMap','layers'].includes(type)&&validStructure(blocks,ACTIVITY_GRID)&&canonicalize(blocks).length===10; }
export function challengeScore(hintShown:boolean, answerRevealed:boolean, completed:boolean):number {
  if (!completed || answerRevealed) return 0;
  return hintShown ? 1 : 2;
}
