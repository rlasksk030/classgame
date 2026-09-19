import {useEffect,useState} from 'react';
import {activityApi,getStudentHome,type StudentHomeData} from '../../lib/studentApi';
export default function ReviewSummary(){
 const [home,setHome]=useState<StudentHomeData|null>(null),[confidence,setConfidence]=useState(2),[reflection,setReflection]=useState(''),[message,setMessage]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
 useEffect(()=>{
 let active=true;
 void getStudentHome().then(value=>{if(active)setHome(value);}).catch(()=>{if(active)setMessage('진도를 불러오지 못했습니다.');});
 void activityApi<{evaluation:{confidence:number;reflection:string}|null}>('review:get').then(({evaluation})=>{
  if(active){if(evaluation){setConfidence(evaluation.confidence);setReflection(evaluation.reflection);}setLoading(false);}
 }).catch(()=>{if(active)setMessage('저장된 자기평가를 불러오지 못했습니다.');});
 return ()=>{active=false;};
 },[]);
 return <section className="panel stack"><h2>단원 돌아보기</h2><p>완료 {home?.lessons.filter(l=>l.completed).length??0}/12차시 · {home?.rewards.totalXp??0} XP · 별 {home?.rewards.totalStars??0}</p><p>{home?.rewards.badges.map(String).join(' · ')}</p><label>나의 자신감<select disabled={loading||saving} value={confidence} onChange={e=>setConfidence(Number(e.target.value))}><option value={1}>더 연습하고 싶어요</option><option value={2}>스스로 할 수 있어요</option><option value={3}>친구에게 설명할 수 있어요</option></select></label><label>배운 점<textarea disabled={loading||saving} className="field" maxLength={1000} value={reflection} onChange={e=>setReflection(e.target.value)}/></label><button className="btn" disabled={loading||saving} onClick={async()=>{if(loading||saving)return;setSaving(true);try{await activityApi('review:save',{confidence,reflection});setMessage('자기평가를 저장했어요.');}catch{setMessage('저장하지 못했습니다. 다시 시도해 주세요.');}finally{setSaving(false);}}}>자기평가 저장</button><p role="status">{message}</p></section>;
}
