import {readFileSync} from 'node:fs';
import type {Page} from '@playwright/test';
import {test,expect,configureLivePage} from './live-fixture';
import {liveApi,CLASS,STUDENTS,SYNTHETIC_PIN} from './support/live-api';
import {EMPTY_BUILDING} from '../shared/activities';
const saved='저장 완료! 다른 기기에서도 이어서 할 수 있어요';
async function connect(page:Page,api:Awaited<ReturnType<typeof liveApi>>){await configureLivePage(page);await page.route('https://math-e2e.invalid/functions/v1/*',async route=>{const r=route.request();const response=await api.request(r.url(),r.postDataJSON(),r.headers()['x-student-token']);await route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'});});}
async function login(page:Page,name='QA학생1'){await page.goto('/?class=QAONLY');await page.getByLabel('이름',{exact:true}).fill(name);await page.getByLabel('PIN 4자리').fill(SYNTHETIC_PIN);await page.getByRole('button',{name:'들어가기',exact:true}).click();await expect(page.getByRole('heading',{name:'공간과 입체 월드',exact:true})).toBeVisible();}
async function stack(page:Page,count:number){await page.getByText('버튼으로 놓기',{exact:true}).click();await page.getByLabel('가로',{exact:true}).fill('1');await page.getByLabel('세로',{exact:true}).fill('1');for(let i=0;i<count;i++)await page.getByRole('button',{name:'쌓기',exact:true}).click();}
const tower=Array.from({length:10},(_,y)=>({x:0,y,z:0}));
const complete={...EMPTY_BUILDING,building_name:'합성 과학관',reason:'층마다 비교하기',description:'모양 관찰',blocks:tower,layer_notes:Array.from({length:10},(_,i)=>`공간 ${i+1}\n층별 설명`)};

test('L9 lost response, retry dedup, readback, reload, peer code and private answer protection',async({page,browser})=>{
 const api=await liveApi();const context=await browser.newContext({baseURL:'http://127.0.0.1:4173'});try{
  await connect(page,api);await login(page);await page.goto('/lesson/9');await page.getByText('버튼으로 놓기',{exact:true}).click();
  for(let i=0;i<10;i++){await page.getByLabel('가로',{exact:true}).fill(String(i%5+1));await page.getByLabel('세로',{exact:true}).fill(String(Math.floor(i/5)+1));await page.getByRole('button',{name:'쌓기',exact:true}).click();}
  await page.getByRole('button',{name:'10개 완성 → 문제 카드 고르기'}).click();await page.getByRole('button',{name:'이 카드로 정하기 →'}).click();await page.getByRole('button',{name:'힌트 카드 확인 →'}).click();
  await page.route('https://math-e2e.invalid/functions/v1/student-api',async route=>{const r=route.request();if(r.postDataJSON().action==='activity:challenge:create'){await api.request(r.url(),r.postDataJSON(),r.headers()['x-student-token']);await route.abort('failed');}else await route.fallback();});
  await page.getByRole('button',{name:'이 문제 저장',exact:true}).click();await expect(page.getByRole('heading',{name:'내 문제가 저장됐어요!'})).toBeVisible();
  const code=await page.getByLabel('내 문제 저장 완료').locator('strong').innerText();expect(code).toMatch(/^[A-Z0-9]{6}$/);
  await page.reload();await page.getByRole('button',{name:`내 문제 ${code}`,exact:true}).click();await expect(page.getByLabel('내 문제 저장 완료')).toContainText(code);
  expect((await api.pg.query('select count(*)::int n from sb_shared_challenges where author_id=$1',[STUDENTS[0]])).rows[0].n).toBe(1);
  const friend=await context.newPage();await connect(friend,api);await login(friend,'QA학생2');await friend.goto('/lesson/9');await friend.getByLabel('친구 문제 코드').fill(code);const response=friend.waitForResponse(r=>r.request().postDataJSON()?.action==='activity:challenge:get');await friend.getByRole('button',{name:'친구 문제 열기'}).click();const dto=await(await response).json();expect(dto).not.toHaveProperty('answer');expect(dto).not.toHaveProperty('blocks');await expect(friend.getByRole('button',{name:'정답 확인',exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/activity-challenge.png',fullPage:true});
 }finally{await context.close();await api.close();}
});

test('L10 old three-floor design expands through ten and restores in a fresh session',async({page,browser})=>{
 const api=await liveApi();const context=await browser.newContext({baseURL:'http://127.0.0.1:4173'});try{
  const old={...complete,blocks:tower.slice(0,3),max_height:3,layer_notes:['기존 로비\n안내','기존 전시\n과학','기존 도서\n독서']};await api.pg.query('select sb_save_building($1,$2,0,$3)',[STUDENTS[0],CLASS,old]);
  await connect(page,api);await login(page);await page.goto('/lesson/10');await expect(page.getByLabel('공간 이름',{exact:true})).toHaveValue('기존 로비');await expect(page.getByRole('tab',{name:'10층',exact:true})).toBeVisible();await stack(page,7);await expect(page.getByText('쌓기나무 10개',{exact:true})).toBeVisible();await page.getByRole('button',{name:'10차시 설계 저장',exact:true}).click();await expect(page.getByRole('status').first()).toHaveText(saved);
  const loaded=(await api.pg.query<{blocks:unknown[];max_height:number;layer_notes:string[]}>('select blocks,max_height,layer_notes from sb_projects where student_id=$1',[STUDENTS[0]])).rows[0];expect(loaded.blocks).toEqual(tower);expect(loaded.max_height).toBe(10);expect(loaded.layer_notes.slice(0,3)).toEqual(old.layer_notes);
  await page.reload();await expect(page.getByText('쌓기나무 10개',{exact:true})).toBeVisible();
  const fresh=await context.newPage();await connect(fresh,api);await login(fresh);await fresh.goto('/lesson/11');await expect(fresh.getByRole('heading',{name:complete.building_name,exact:true})).toBeVisible();await fresh.getByRole('button',{name:'건축물 수정하기'}).click();await expect(fresh.getByText('쌓기나무 10개',{exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/activity-ten-floors.png',fullPage:true});
 }finally{await context.close();await api.close();}
});

test('L11 completion, real PNG/PDF files, same-class read-only and revoke',async({page,browser})=>{
 const api=await liveApi();const context=await browser.newContext({baseURL:'http://127.0.0.1:4173'});try{
  await api.pg.query('select sb_save_building($1,$2,0,$3)',[STUDENTS[0],CLASS,complete]);await connect(page,api);await login(page);await page.goto('/lesson/11');await page.getByLabel('건축물 설명',{exact:true}).fill('긴 소개 문장입니다. '.repeat(120));
  await page.getByRole('button',{name:'소개서 완성',exact:true}).click();await expect(page.getByRole('status').first()).toHaveText('작품 완성! 공유할 수 있어요');
  const pngDownload=page.waitForEvent('download');await page.getByRole('button',{name:'PNG 이미지 저장'}).click();const png=await pngDownload;await png.saveAs('test-results/activity-brochure.png');expect(readFileSync('test-results/activity-brochure.png').subarray(1,4).toString()).toBe('PNG');
  const pdfDownload=page.waitForEvent('download');await page.getByRole('button',{name:'A4 PDF 저장'}).click();const pdf=await pdfDownload;await pdf.saveAs('test-results/activity-brochure.pdf');const bytes=readFileSync('test-results/activity-brochure.pdf');expect(bytes.subarray(0,8).toString()).toBe('%PDF-1.4');expect((bytes.toString('latin1').match(/\/Type \/Page\b/g)??[]).length).toBeGreaterThan(2);expect((bytes.toString('latin1').match(/\/Subtype \/Image/g)??[]).length).toBeGreaterThan(2);
  await page.getByRole('button',{name:'우리 반에 공유하기'}).click();const link=page.getByLabel('소개서 공유').getByRole('link');await expect(link).toBeVisible();const href=await link.getAttribute('href');expect(href).toMatch(/\/gallery\/[a-f0-9]{32}$/);
  const friend=await context.newPage();await connect(friend,api);await login(friend,'QA학생2');await friend.goto(href!);await expect(friend.getByRole('heading',{name:complete.building_name,exact:true})).toBeVisible();await expect(friend.getByRole('button',{name:'설계 저장',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'공유 중지',exact:true}).click();await expect(link).toHaveCount(0);await friend.reload();await expect(friend.getByText(/공유가 중지된 소개서는 열 수 없어요/)).toBeVisible();await expect(friend.getByLabel('건축물 소개서')).toHaveCount(0);
  expect((await api.pg.query('select count(*)::int n from sb_student_progress where student_id=$1 and completed',[STUDENTS[0]])).rows[0].n).toBe(2);expect((await api.pg.query('select count(*)::int n from sb_projects where student_id=$1',[STUDENTS[1]])).rows[0].n).toBe(0);
 }finally{await context.close();await api.close();}
});

test('save failure keeps draft after reload; conflicting device requires explicit comparison',async({page})=>{
 const api=await liveApi();try{
  await connect(page,api);await login(page);await page.goto('/lesson/10');await page.getByLabel('건축물 이름',{exact:true}).fill('이 기기 설계');let offline=true;
  await page.route('https://math-e2e.invalid/functions/v1/student-api',async route=>{if(offline&&route.request().postDataJSON()?.action==='activity:project:save')await route.abort('failed');else await route.fallback();});
  await page.getByRole('button',{name:'10차시 설계 저장',exact:true}).click();await expect(page.getByRole('status').first()).toHaveText('저장하지 못했어요. 내용을 유지하고 있으니 다시 시도해 주세요');await page.reload();await expect(page.getByLabel('건축물 이름',{exact:true})).toHaveValue('이 기기 설계');offline=false;await page.getByRole('button',{name:'10차시 설계 저장',exact:true}).click();await expect(page.getByRole('status').first()).toHaveText(saved);
  const existing=(await api.pg.query<{version:number}>('select version from sb_projects where student_id=$1',[STUDENTS[0]])).rows[0];await api.pg.query('select sb_save_building($1,$2,$3,$4)',[STUDENTS[0],CLASS,existing.version,{...complete,building_name:'다른 기기 설계'}]);
  await page.getByLabel('설계 이유',{exact:true}).fill('내 기기 수정');await page.getByRole('button',{name:'10차시 설계 저장',exact:true}).click();await expect(page.getByLabel('설계 충돌 비교')).toBeVisible();await expect(page.getByRole('heading',{name:'다른 기기 설계',exact:true})).toBeVisible();await page.getByRole('button',{name:'서버 설계 불러오기',exact:true}).click();await expect(page.getByLabel('건축물 이름',{exact:true})).toHaveValue('다른 기기 설계');
 }finally{await api.close();}
});

test('thousand-block render and save stay responsive and preserve the payload',async({page},info)=>{
 const api=await liveApi();try{
  const blocks=Array.from({length:1000},(_,i)=>({x:i%10,y:Math.floor(i/100),z:Math.floor(i/10)%10}));
  await api.pg.query('select sb_save_building($1,$2,0,$3)',[STUDENTS[0],CLASS,{...complete,blocks}]);
  await connect(page,api);await login(page);const start=Date.now();await page.goto('/lesson/10');await expect(page.getByText('쌓기나무 1000개',{exact:true})).toBeVisible();
  const loadMs=Date.now()-start;
  const frames=await page.evaluate(()=>new Promise<number[]>(resolve=>{const times:number[]=[];let previous=performance.now();function frame(now:number){times.push(now-previous);previous=now;if(times.length<40)requestAnimationFrame(frame);else resolve(times);}requestAnimationFrame(frame);}));
  await page.getByLabel('건축물 설명',{exact:true}).fill('천 개 블록 저장');const saving=Date.now();await page.getByRole('button',{name:'10차시 설계 저장',exact:true}).click();await expect(page.getByRole('status').first()).toHaveText(saved);const saveMs=Date.now()-saving;
  expect((await api.pg.query<{blocks:unknown[]}>('select blocks from sb_projects where student_id=$1',[STUDENTS[0]])).rows[0].blocks).toEqual(blocks);
  const sorted=frames.slice(1).sort((a,b)=>a-b);await info.attach('synthetic-desktop-performance',{body:JSON.stringify({loadMs,saveMs,frameMedianMs:sorted[Math.floor(sorted.length/2)],frameP95Ms:sorted[Math.floor(sorted.length*.95)],payloadBytes:JSON.stringify({...complete,blocks}).length,physicalTablet:'NOT_VERIFIED'}),contentType:'application/json'});
  expect(sorted[Math.floor(sorted.length*.95)]).toBeLessThan(500);
  await page.screenshot({path:`test-results/activity-thousand-${info.project.name}.png`,fullPage:true});
 }finally{await api.close();}
});
