import test from 'node:test';
import assert from 'node:assert/strict';
import {brochureCanvases,drawBuilding} from '../src/features/activities/brochureExport.ts';
import {EMPTY_BUILDING} from '../shared/activities.ts';
function context(){
 const texts:Array<{text:string;x:number;y:number;font:string}>=[],rects:Array<{x:number;y:number;color:string}>=[],points:number[][]=[];
 const ctx={fillStyle:'',strokeStyle:'',lineWidth:1,font:'',beginPath(){},closePath(){},fill(){},stroke(){},moveTo(x:number,y:number){points.push([x,y]);},lineTo(x:number,y:number){points.push([x,y]);},fillText(text:string,x:number,y:number){texts.push({text,x,y,font:this.font});},fillRect(x:number,y:number){rects.push({x,y,color:this.fillStyle});},measureText(text:string){return {width:[...text].length*20};}};
 return {ctx:ctx as unknown as CanvasRenderingContext2D,texts,rects,points};
}
test('export projection matches screen orientation; full Korean text paginates within A4 without private metadata',()=>{
 const pages:ReturnType<typeof context>[]=[];
 const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement(){const page=context();pages.push(page);return {width:0,height:0,getContext:()=>page.ctx};}}});
 try{
  const text='긴 한글 소개 문장입니다. '.repeat(120),note='공간 이름\n층 설명';
  const building={...EMPTY_BUILDING,building_name:'과학관',reason:'공간 비교',description:text,blocks:[{x:0,y:0,z:0}],layer_notes:[note,...Array(9).fill('')],student_id:'PRIVATE-ID',pin:'PRIVATE-PIN',token:'PRIVATE-TOKEN'};
  const exported=[...brochureCanvases(building)];assert.ok(exported.length>1);
  const written=pages.flatMap(p=>p.texts);
  assert(written.every(t=>t.y>=90&&t.y<=1754-45));
  const narrative=written.filter(t=>t.text.startsWith('긴 ')||t.text.includes('한글')||t.text.includes('소개')||t.text.includes('문장'));
  assert(narrative.length>5);
  const flattened=written.filter(t=>t.font==='28px sans-serif').map(t=>t.text).join('');assert(flattened.includes(text),'every character continues onto the next page');assert(!flattened.includes('PRIVATE-'));
  const top=pages[0].rects.find(r=>r.color==='#8eb8c9');assert.equal(top?.x,90);assert.equal(top?.y,810,'front-near cell appears at bottom of the top view');
 }finally{if(previous)Object.defineProperty(globalThis,'document',previous);else Reflect.deleteProperty(globalThis,'document');}
});
test('isometric ten-floor and thousand-block images fit inside the export viewport',()=>{
 for(const blocks of [Array.from({length:10},(_,y)=>({x:0,y,z:0})),Array.from({length:1000},(_,i)=>({x:i%10,y:Math.floor(i/100),z:Math.floor(i/10)%10}))]){
  const {ctx,points}=context();drawBuilding(ctx,{...EMPTY_BUILDING,blocks},90,155,1060,430);
  assert(points.length>0);assert(points.every(([x,y])=>x>=90&&x<=1150&&y>=155&&y<=585));
 }
});
