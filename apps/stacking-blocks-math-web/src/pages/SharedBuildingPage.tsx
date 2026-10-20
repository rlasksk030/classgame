import {useEffect,useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import type {Building} from '../../shared/activities.ts';
import {activityApi,getStudentToken} from '../lib/studentApi';
import BuildingBrochure from '../features/activities/BuildingBrochure';
export default function SharedBuildingPage(){
 const {slug}=useParams();const [building,setBuilding]=useState<Building|null>(null),[message,setMessage]=useState('소개서를 불러오고 있어요.');
 useEffect(()=>{let active=true;const read=()=>{void activityApi<{building:Building}>('project:shared',{lesson:11,slug}).then(r=>{if(active){setBuilding(r.building);setMessage('우리 반 친구의 작품이에요. 읽기 전용으로 감상할 수 있어요.');}}).catch(()=>{if(active){setBuilding(null);setMessage('우리 반으로 로그인했는지 확인해 주세요. 공유가 중지된 소개서는 열 수 없어요.');}});};if(getStudentToken())read();else setMessage('우리 반 학생으로 로그인한 뒤 이 링크를 다시 열어 주세요.');const timer=setInterval(read,15000);window.addEventListener('focus',read);return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',read);};},[slug]);
 return <main className="screen app-max stack"><h1>우리 반 건축물 감상</h1><Link to="/world">월드로</Link><p role="status">{message}</p>{!getStudentToken()&&<Link to="/">학생 로그인</Link>}{building&&<BuildingBrochure building={building}/>}</main>;
}
