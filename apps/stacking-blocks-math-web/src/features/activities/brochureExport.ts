import { canonicalize, project } from '../../../shared/blocks.ts';
import { projectionToDisplayGrid } from '../../../shared/problems/contracts/display.ts';
import { usedFloors, type Building } from '../../../shared/activities.ts';
const WIDTH=1240, HEIGHT=1754, MARGIN=90, LINE=44;
const colors:Record<string,string[]>={wood:['#ead0a9','#c99e68','#a47545'],pastel:['#f5d9e6','#d9a8bd','#b97d99'],brick:['#e9ad96','#c97b68','#a45645'],tile:['#cce1eb','#8eb8c9','#6090a5']};
/** Deterministic isometric rendering from saved coordinates; no DOM, identity or tokens. */
export function drawBuilding(ctx:CanvasRenderingContext2D,b:Building,x:number,y:number,width:number,height:number){
 const vertices=b.blocks.flatMap(p=>[0,1].flatMap(dx=>[0,1].flatMap(dy=>[0,1].map(dz=>({x:p.x+dx,y:p.y+dy,z:p.z+dz})))));
 const px=vertices.map(p=>p.x-p.z),py=vertices.map(p=>-(p.x+p.z)/2-p.y);
 const minX=Math.min(0,...px),maxX=Math.max(1,...px),minY=Math.min(0,...py),maxY=Math.max(0,...py);
 const scale=Math.min(width/(maxX-minX+2),height/(maxY-minY+2));
 const point=(a:number,c:number,e:number)=>[x+width/2+(a-e-(minX+maxX)/2)*scale,y+height/2+(-(a+e)/2-c-(minY+maxY)/2)*scale];
 const face=(points:number[][],color:string)=>{ctx.beginPath();points.forEach(([a,c],i)=>i?ctx.lineTo(a,c):ctx.moveTo(a,c));ctx.closePath();ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#ffffff90';ctx.lineWidth=1;ctx.stroke();};
 for(const p of [...canonicalize(b.blocks)].sort((a,c)=>c.x+c.z-a.x-a.z||a.y-c.y)){
  const palette=colors[b.block_appearance?.[`${p.x},${p.y},${p.z}`]??'wood']??colors.wood;
  const {x:a,y:c,z:e}=p;
  face([point(a,c,e),point(a+1,c,e),point(a+1,c+1,e),point(a,c+1,e)],palette[1]);
  face([point(a,c,e),point(a,c,e+1),point(a,c+1,e+1),point(a,c+1,e)],palette[2]);
  face([point(a,c+1,e),point(a+1,c+1,e),point(a+1,c+1,e+1),point(a,c+1,e+1)],palette[0]);
 }
}
function canvas(theme:Building['intro_theme']){const c=document.createElement('canvas');c.width=WIDTH;c.height=HEIGHT;const ctx=c.getContext('2d');if(!ctx)throw Error('EXPORT_UNAVAILABLE');ctx.fillStyle=theme==='museum'?'#fff8e9':theme==='sky'?'#edfaff':'white';ctx.fillRect(0,0,WIDTH,HEIGHT);return {c,ctx};}
export function wrapText(ctx:CanvasRenderingContext2D,text:string,width:number){
 const lines:string[]=[];
 for(const paragraph of text.split('\n')){let line='';for(const char of Array.from(paragraph)){if(line&&ctx.measureText(line+char).width>width){lines.push(line);line='';}line+=char;}lines.push(line);}
 return lines;
}
/** A4 page boundaries are made between text lines, never by clipping a long screenshot. */
export function* brochureCanvases(b:Building,summary=false):Generator<HTMLCanvasElement>{
 let {c,ctx}=canvas(b.intro_theme),y=MARGIN,page=1;
 const heading=()=>{ctx.fillStyle='#183b4e';ctx.font='bold 38px sans-serif';ctx.fillText('나만의 건축물 소개서',MARGIN,y);y+=65;};
 const footer=()=>{ctx.font='24px sans-serif';ctx.fillStyle='#53616a';ctx.fillText(`공간과 입체 · ${page}`,MARGIN,HEIGHT-45);};
 heading();drawBuilding(ctx,b,MARGIN,y,WIDTH-MARGIN*2,430);y+=460;
 const views=project(b.blocks,{gridWidth:b.grid_width??10,gridDepth:b.grid_depth??10,maxHeight:b.max_height??10});
 for(const [index,face] of (['top','front','side'] as const).entries()){
  const rows=projectionToDisplayGrid(views[face],face),size=Math.min(20,240/Math.max(rows.length,rows[0]?.length??1)),start=MARGIN+index*350;
  ctx.fillStyle='#183b4e';ctx.font='26px sans-serif';ctx.fillText(['위','앞','옆'][index],start,y);
  rows.forEach((row,r)=>row.forEach((cell,col)=>{ctx.fillStyle=cell?'#8eb8c9':'#f0f3f6';ctx.fillRect(start+col*size,y+15+r*size,size-1,size-1);}));
 }
 y+=280;
 const sections:[string,string][]=[['건축물 이름',b.building_name],['설계 이유',b.reason],['건축물 설명',b.description],...usedFloors(b).map(f=>[`${f+1}층 공간`,b.layer_notes[f]??''] as [string,string])];
 for(const [title,text] of sections){
  ctx.font='28px sans-serif';
  const brief=text.replace(/\n/g,' '),limit=title.endsWith('공간')?30:100;
  const lines=wrapText(ctx,summary?(brief.length>limit?brief.slice(0,limit)+'…':brief):text,WIDTH-MARGIN*2);
  if(summary&&y+80+lines.length*LINE>HEIGHT-MARGIN){ctx.fillStyle='#53616a';ctx.font='26px sans-serif';ctx.fillText('전체 설명과 층별 소개는 PDF에서 볼 수 있어요.',MARGIN,y);break;}
  if(y+100>HEIGHT-MARGIN){footer();yield c;({c,ctx}=canvas(b.intro_theme));page++;y=MARGIN;heading();}
  ctx.font='bold 30px sans-serif';ctx.fillStyle='#183b4e';ctx.fillText(title,MARGIN,y);y+=LINE;
  for(const line of lines){if(y+LINE>HEIGHT-MARGIN){footer();yield c;({c,ctx}=canvas(b.intro_theme));page++;y=MARGIN;heading();}ctx.font='28px sans-serif';ctx.fillStyle='#25323c';ctx.fillText(line,MARGIN,y);y+=LINE;}
  y+=20;
 }
 footer();yield c;
}
function blob(canvas:HTMLCanvasElement,type:string):Promise<Blob>{return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('EXPORT_FAILED')),type,0.94));}
export async function brochurePng(b:Building):Promise<File>{await document.fonts.ready;const c=brochureCanvases(b,true).next().value!;return new File([await blob(c,'image/png')],'건축물-소개서.png',{type:'image/png'});}
/** Small image-only PDF writer: embedded rendered Korean text needs no remote font service. */
export async function brochurePdf(b:Building):Promise<File>{
 await document.fonts.ready;
 const encoder=new TextEncoder(),objects:Uint8Array[]=[],imagePages:Array<{image:number;content:number;page:number}>=[];
 const bytes=(s:string)=>encoder.encode(s);
 const join=(parts:Uint8Array[])=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}return out;};
 const add=(data:string|Uint8Array)=>{objects.push(typeof data==='string'?bytes(data):data);return objects.length;};
 add('');add('');
 for(const c of brochureCanvases(b)){
  const jpeg=new Uint8Array(await(await blob(c,'image/jpeg')).arrayBuffer());
  const image=add(join([bytes(`<< /Type /XObject /Subtype /Image /Width ${WIDTH} /Height ${HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),jpeg,bytes('\nendstream')]));
  const commands='q 595.276 0 0 841.89 0 0 cm /I Do Q';
  const content=add(`<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`);
  const page=add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.276 841.89] /Resources << /XObject << /I ${image} 0 R >> >> /Contents ${content} 0 R >>`);
  imagePages.push({image,content,page});c.width=1;c.height=1;
 }
 objects[0]=bytes('<< /Type /Catalog /Pages 2 0 R >>');objects[1]=bytes(`<< /Type /Pages /Kids [${imagePages.map(p=>`${p.page} 0 R`).join(' ')}] /Count ${imagePages.length} >>`);
 const parts=[bytes('%PDF-1.4\n')],offsets=[0];let length=parts[0].length;
 objects.forEach((o,i)=>{offsets.push(length);const data=join([bytes(`${i+1} 0 obj\n`),o,bytes('\nendobj\n')]);parts.push(data);length+=data.length;});
 parts.push(bytes(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
 return new File([join(parts)],'건축물-소개서.pdf',{type:'application/pdf'});
}
export function downloadBrochure(file:File){const url=URL.createObjectURL(file);const link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
