import { useEffect,useState } from 'react';
import type { Building } from '../../../shared/activities.ts';
import { activityApi } from '../../lib/studentApi';
import { brochurePng,brochurePdf,downloadBrochure } from './brochureExport';
export default function BuildingSharing({building}:{building:Building}){
 const [png,setPng]=useState<File|null>(null),[slug,setSlug]=useState<string|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{let active=true;setPng(null);void brochurePng(building).then(file=>{if(active)setPng(file);}).catch(()=>{if(active)setMessage('이미지를 준비하지 못했어요. 다시 열어 주세요.');});void activityApi<{slug:string|null}>('project:sharing',{lesson:11}).then(r=>{if(active)setSlug(r.slug);}).catch(()=>{if(active)setMessage('공유 상태를 확인하지 못했어요.');});return()=>{active=false;};},[building]);
 const change=async(enable:boolean)=>{if(busy)return;setBusy(true);try{const result=await activityApi<{slug:string|null}>('project:share',{lesson:11,version:building.version,enable});const check=await activityApi<{slug:string|null}>('project:sharing',{lesson:11});if(check.slug!==result.slug||Boolean(check.slug)!==enable)throw Error();setSlug(check.slug);setMessage(enable?'로그인한 우리 반 친구만 볼 수 있어요.':'공유를 중지했어요. 이전 링크로는 열 수 없어요.');}catch{setMessage('공유 상태를 확인하지 못했어요. 다시 시도해 주세요.');}finally{setBusy(false);}};
 const link=slug?`${location.origin}${import.meta.env.BASE_URL.replace(/\/$/,'')}/gallery/${slug}`:'';
 return <section className="panel stack" aria-label="소개서 공유"><h2>완성한 소개서 나누기</h2><p>이름이나 연락처가 설명에 들어 있지 않은지 확인해 주세요. 가족에게는 파일로 보내고, 링크는 로그인한 우리 반 친구만 볼 수 있어요.</p><div className="toolbar-row">
 <button className="btn" disabled={!png} onClick={()=>{if(png)downloadBrochure(png);}}>PNG 이미지 저장</button>
 <button className="btn" disabled={busy} onClick={()=>{setBusy(true);void brochurePdf(building).then(downloadBrochure).catch(()=>setMessage('PDF를 만들지 못했어요. 다시 시도해 주세요.')).finally(()=>setBusy(false));}}>A4 PDF 저장</button>
 <button className="btn" disabled={!png} onClick={()=>{if(!png)return;if(navigator.canShare?.({files:[png]})){void navigator.share({files:[png],title:'건축물 소개서'}).then(()=>setMessage('기기 공유를 마쳤어요.')).catch(()=>setMessage('공유를 취소했거나 기기에서 공유할 수 없어요. 이미지 저장을 이용해 주세요.'));}else{downloadBrochure(png);setMessage('이 기기에서는 공유 창 대신 이미지 파일로 저장해요.');}}}>이미지로 다른 사람에게 공유</button>
 <button className="btn" disabled={busy||Boolean(slug)} onClick={()=>void change(true)}>우리 반에 공유하기</button>
 <button className="btn" disabled={!slug||busy} onClick={()=>void navigator.clipboard.writeText(link).then(()=>setMessage('우리 반 공유 링크를 복사했어요.')).catch(()=>setMessage('링크를 길게 눌러 복사해 주세요.'))}>공유 링크 복사</button>
 <button className="btn" disabled={!slug||busy} onClick={()=>void change(false)}>공유 중지</button>
 </div>{slug&&<a href={link}>{link}</a>}<p role="status">{message}</p><p className="muted">PNG는 주요 소개를 담아요. 긴 설명과 모든 층은 PDF에 여러 장으로 담겨요. 작품을 다시 저장하면 기존 링크의 공유는 중지돼요.</p></section>;
}
