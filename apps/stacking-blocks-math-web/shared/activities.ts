import { canonicalize, project, toHeightMap, toLayers, validStructure } from './blocks.ts';
import type { BlockCoord } from './types.ts';
import type { RewardMaterial, RewardTheme } from './rewards.ts';
export const ACTIVITY_GRID = {gridWidth:5,gridDepth:5,maxHeight:3};
/** 건축 프로젝트 전용 기본 작업판. 일반 문제/친구 문제 작업판과 분리한다. */
export const ARCHITECTURE_GRID = {gridWidth:8,gridDepth:8,maxHeight:3};
export type ChallengeType = 'views'|'top'|'heightMap'|'layers';
export interface Building { building_name:string;reason:string;description:string;layer_notes:string[];blocks:BlockCoord[];version:number;submitted:boolean;grid_width?:number;grid_depth?:number;max_height?:number; block_appearance?:Record<string,RewardMaterial>; intro_theme?:RewardTheme }
export const EMPTY_BUILDING:Building={building_name:'',reason:'',description:'',layer_notes:['','',''],blocks:[],version:0,submitted:false,grid_width:ARCHITECTURE_GRID.gridWidth,grid_depth:ARCHITECTURE_GRID.gridDepth,max_height:ARCHITECTURE_GRID.maxHeight,block_appearance:{},intro_theme:'blueprint'};
export function validBuilding(value:Building,complete=false) {
  if (!value || !Array.isArray(value.layer_notes)) return false;
  const configuredGrid = Number.isInteger(value.grid_width) && Number.isInteger(value.grid_depth) && Number.isInteger(value.max_height)
    ? { gridWidth: Number(value.grid_width), gridDepth: Number(value.grid_depth), maxHeight: Number(value.max_height) }
    : ARCHITECTURE_GRID;
  const fitsDefaultGrid = validStructure(value.blocks,configuredGrid) || validStructure(value.blocks,ARCHITECTURE_GRID) || validStructure(value.blocks,ACTIVITY_GRID);
  return fitsDefaultGrid && [value.building_name,value.reason,value.description,...value.layer_notes].every(s=>typeof s==='string'&&s.length<=2000)
    && value.layer_notes.length===3 && (!complete || (value.building_name.trim().length>0 && value.reason.trim().length>0 && value.description.trim().length>0 && value.layer_notes.every(s=>s.trim()) && value.blocks.some(b=>b.y===2)));
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
