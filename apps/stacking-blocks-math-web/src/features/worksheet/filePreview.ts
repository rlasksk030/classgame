/** Teacher-only parser boundary. Future formats can add a renderer here. No AI/OCR. */
export interface FilePreview { pages:number;render:(page:number)=>Promise<HTMLCanvasElement>;dispose:()=>void }
export async function openWorksheet(file:File):Promise<FilePreview>{
 if(file.size>20*1024*1024)throw new Error('20MB 이하 파일을 선택해 주세요.');
 if(file.type==='application/pdf'){
  const pdfjs=await import('pdfjs-dist');
  const worker=await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc=worker.default;
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())});
  const document=await task.promise;
  if(document.numPages>40){await task.destroy();throw new Error('40쪽 이하로 나누어 업로드해 주세요.');}
  return {pages:document.numPages,render:async(number)=>{const page=await document.getPage(number);const original=page.getViewport({scale:1});const viewport=page.getViewport({scale:Math.min(1.5,1100/original.width)});const canvas=window.document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;await page.render({canvas,viewport}).promise;return canvas;},dispose:()=>void task.destroy()};
 }
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('PDF, PNG, JPG, WEBP를 지원합니다. DOCX/HWPX는 PDF로 변환해 주세요.');
 const bitmap=await createImageBitmap(file);
 if(bitmap.width*bitmap.height>30000000){bitmap.close();throw new Error('이미지 크기가 너무 큽니다. 축소해서 올려 주세요.');}
 return {pages:1,render:async()=>{const canvas=document.createElement('canvas');const scale=Math.min(1,1100/bitmap.width);canvas.width=bitmap.width*scale;canvas.height=bitmap.height*scale;canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);return canvas;},dispose:()=>bitmap.close()};
}
export interface CropRect{x:number;y:number;width:number;height:number}
export async function cropPage(canvas:HTMLCanvasElement,rect:CropRect):Promise<Blob>{
 if(rect.width<12||rect.height<12)throw new Error('문제 영역을 조금 더 크게 선택해 주세요.');
 const crop=document.createElement('canvas');crop.width=rect.width;crop.height=rect.height;
 crop.getContext('2d')!.drawImage(canvas,rect.x,rect.y,rect.width,rect.height,0,0,crop.width,crop.height);
 return new Promise((resolve,reject)=>crop.toBlob(blob=>blob?resolve(blob):reject(new Error('이미지를 자르지 못했습니다.')),'image/png'));
}
