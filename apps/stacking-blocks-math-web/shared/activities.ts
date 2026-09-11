import { canonicalize, project, toHeightMap, toLayers, validStructure } from './blocks.ts';
import type { BlockCoord } from './types.ts';
export const ACTIVITY_GRID = {gridWidth:5,gridDepth:5,maxHeight:3};
export const ARCHITECTURE_GRID = {gridWidth:4,gridDepth:4,maxHeight:3};
export type ChallengeType = 'views'|'top'|'heightMap'|'layers';
export interface Building { building_name:string;reason:string;description:string;layer_notes:string[];blocks:BlockCoord[];version:number;submitted:boolean }
export const EMPTY_BUILDING:Building={building_name:'',reason:'',description:'',layer_notes:['','',''],blocks:[],version:0,submitted:false};
export function validBuilding(value:Building,complete=false) {
  if (!value || !Array.isArray(value.layer_notes)) return false;
  const fitsDefaultGrid = validStructure(value.blocks,ARCHITECTURE_GRID) || validStructure(value.blocks,ACTIVITY_GRID);
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
