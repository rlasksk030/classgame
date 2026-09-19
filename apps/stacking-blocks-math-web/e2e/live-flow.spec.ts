import type {Page,BrowserContext} from '@playwright/test';
import {test,expect,configureLivePage} from './live-fixture';
import {liveApi,SYNTHETIC_PIN,STUDENTS} from './support/live-api';
import {SEED_PROBLEMS} from '../shared/seedProblems.ts';
import {generatePeerPracticeBank} from '../shared/peerPracticeBank.ts';
import type {BlockCoord} from '../shared/types.ts';

type Api=Awaited<ReturnType<typeof liveApi>>;
async function connect(page:Page,api:Api){
 await configureLivePage(page);
 await page.route('https://math-e2e.invalid/functions/v1/*',async route=>{
  const req=route.request();const response=await api.request(req.url(),req.postDataJSON(),req.headers()['x-student-token']);
  await route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'});
 });
}
async function login(page:Page,name='QA학생1'){
 await page.goto('/?class=QAONLY');await page.getByLabel('이름',{exact:true}).fill(name);await page.getByLabel('PIN 4자리').fill(SYNTHETIC_PIN);
 await page.getByRole('button',{name:'들어가기',exact:true}).click();await expect(page.getByRole('heading',{name:'공간과 입체 월드',exact:true})).toBeVisible();
}
async function stack(page:Page,blocks:BlockCoord[]){
 await page.getByText('버튼으로 놓기',{exact:true}).click();
 for(const b of [...blocks].sort((a,b)=>a.y-b.y)){
  await page.getByLabel('가로',{exact:true}).fill(String(b.x+1));await page.getByLabel('세로',{exact:true}).fill(String(b.z+1));
  await page.getByRole('button',{name:'쌓기',exact:true}).click();
 }
 await expect(page.getByText(`쌓기나무 ${blocks.length}개`,{exact:true})).toBeVisible();
}

test('P0 real routes: login, world, learn, submit, logout/login restore and student isolation',async({page})=>{
 const api=await liveApi();try{
 await connect(page,api);await login(page);
 await page.getByRole('link',{name:/^05 5차시/}).click();
 await expect(page).toHaveURL(/\/lesson\/5\/learn$/);
 await page.getByRole('button',{name:'② 문제 풀기 시작'}).click();
 const p=SEED_PROBLEMS.find(p=>p.code==='L5-01')!;if(p.answer.kind!=='choice')throw Error('fixture contract');
 await page.getByRole('button',{name:`${p.answer.index+1}. ${p.choices[p.answer.index]}`,exact:true}).click();
 await page.getByRole('button',{name:'정답 확인',exact:true}).click();
 await expect(page.getByText(/완료 \+ XP/)).toBeVisible();
 expect(api.submissions.at(-1)?.problemId).toBe('L5-01');
 await page.getByRole('button',{name:'다음 문제',exact:true}).click();
 await expect.poll(()=>api.submissions.length).toBe(1);
 await page.getByRole('button',{name:'월드로',exact:true}).click();await page.getByRole('button',{name:'나가기',exact:true}).click();
 await login(page);await page.goto('/lesson/5/solve');
 await expect(page.getByText(SEED_PROBLEMS.find(p=>p.code==='L5-02')!.title,{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByRole('button',{name:'정답 확인',exact:true})).toBeEnabled();
 await page.goto('/lesson/5/solve');await page.getByRole('button',{name:'이전',exact:true}).click();
 await expect(page.getByRole('button',{name:'정답 확인',exact:true})).toBeDisabled();
 await page.screenshot({path:'test-results/live-progress.png',fullPage:true});
 await page.goto('/world');await page.getByRole('button',{name:'나가기',exact:true}).click();await login(page,'QA학생2');
 await page.goto('/lesson/5/solve');await expect(page.getByRole('button',{name:'정답 확인',exact:true})).toBeEnabled();
 }finally{await api.close();}
});

test('P1 lesson9 live system fallback, real building input, score and no private DTO',async({page})=>{
 const api=await liveApi();try{
 await connect(page,api);await login(page);await page.goto('/lesson/9/learn');await page.getByRole('button',{name:'② 문제 풀기 시작'}).click();
 await expect(page).toHaveURL(/\/lesson\/9$/);
 await expect(page.getByRole('button',{name:/^기본 연습 \d+$/})).toHaveCount(24);
 const responsePromise=page.waitForResponse(r=>r.request().postDataJSON()?.action==='activity:challenge:get');
 await page.getByRole('button',{name:'기본 연습 1',exact:true}).click();
 const dto=await (await responsePromise).json();expect(dto).not.toHaveProperty('answer');expect(dto).not.toHaveProperty('blocks');expect(dto).not.toHaveProperty('hidden_validation_json');expect(dto).not.toHaveProperty('hintGiven');
 await stack(page,generatePeerPracticeBank()[0].blocks);
 await page.getByRole('button',{name:'정답 확인',exact:true}).click();await expect(page.getByText('오답 0회 · 놀이 점수 2 / 2점')).toBeVisible();
 await page.reload();await page.getByRole('button',{name:'기본 연습 24 · 완료',exact:true}).click();
 await expect(page.getByText('오답 0회 · 놀이 점수 2 / 2점')).toBeVisible();
 await expect(page.getByRole('button',{name:'정답 확인',exact:true})).toBeDisabled();
 const rows=await api.pg.query<{score:number}>('select score from sb_challenge_solves where student_id=$1',[STUDENTS[0]]);expect(rows.rows.map(r=>r.score)).toEqual([2]);
 await page.screenshot({path:'test-results/live-lesson9.png',fullPage:true});
 }finally{await api.close();}
});

test('P1 lesson9 creator and independent solver use same API/SQL with hint score',async({page,browser})=>{
 const api=await liveApi();let other:BrowserContext|undefined;try{
 await connect(page,api);await login(page);await page.goto('/lesson/9');await stack(page,generatePeerPracticeBank()[1].blocks);
 await page.getByRole('button',{name:'10개 완성 → 문제 카드 고르기'}).click();await page.getByRole('button',{name:'이 카드로 정하기 →'}).click();await page.getByRole('button',{name:'힌트 카드 확인 →'}).click();await page.getByRole('button',{name:'이 문제 저장',exact:true}).click();await expect(page.getByText(/공유 코드:/)).toBeVisible();
 other=await browser.newContext({baseURL:'http://127.0.0.1:4173'});const friend=await other.newPage();await connect(friend,api);await login(friend,'QA학생2');await friend.goto('/lesson/9');
 await expect(friend.getByRole('button',{name:'친구 문제 1',exact:true})).toBeVisible();await friend.getByRole('button',{name:'친구 문제 1',exact:true}).click();
 await friend.getByRole('button',{name:'힌트 보기 (보상 1점)'}).click();await stack(friend,generatePeerPracticeBank()[1].blocks);await friend.getByRole('button',{name:'정답 확인',exact:true}).click();await expect(friend.getByText('오답 0회 · 놀이 점수 1 / 2점')).toBeVisible();
 expect((await api.pg.query('select * from sb_challenge_solves where student_id=$1',[STUDENTS[0]])).rows).toHaveLength(0);
 await friend.screenshot({path:'test-results/live-peer-solve.png',fullPage:true});
 }finally{await other?.close();await api.close();}
});

test('P1 live lesson10 save and lesson11 restore use same server record',async({page})=>{
 const api=await liveApi();try{
 await connect(page,api);await login(page);await page.goto('/lesson/10/project');
 await page.getByLabel('건축물 이름',{exact:true}).fill('합성 수학관');await page.getByLabel('설계 이유',{exact:true}).fill('모양을 살펴봐요');await stack(page,[{x:0,y:0,z:0}]);
 await page.getByRole('button',{name:'10차시 설계 저장',exact:true}).click();await expect(page.getByRole('status').first()).toHaveText('설계를 저장했어요.');
 await page.goto('/lesson/11/project');await expect(page.getByRole('heading',{name:'합성 수학관',exact:true})).toBeVisible();await page.reload();await expect(page.getByLabel('건축물 이름',{exact:true})).toHaveValue('합성 수학관');
 const r=await api.pg.query<{grid_width:number;blocks:unknown[]}>('select grid_width,blocks from sb_projects where student_id=$1',[STUDENTS[0]]);expect(r.rows[0].grid_width).toBe(10);expect(r.rows[0].blocks).toHaveLength(1);
 await page.screenshot({path:'test-results/live-lesson11.png',fullPage:true});
 }finally{await api.close();}
});

test('P1 live lesson12 numeric submission and reflection persist',async({page})=>{
 const api=await liveApi();try{
 await connect(page,api);await login(page);await page.goto('/lesson/12/solve');
 const p=SEED_PROBLEMS.find(p=>p.code==='L12-01')!;if(p.answer.kind!=='count')throw Error('fixture contract');
 await page.getByPlaceholder('정답을 입력').fill(String(p.answer.value));await page.getByRole('button',{name:'정답 확인',exact:true}).click();await expect(page.getByText(/완료 \+ XP/)).toBeVisible();
 await page.getByLabel('배운 점',{exact:true}).fill('층별로 비교했어요.');await page.getByRole('button',{name:'자기평가 저장',exact:true}).click();await expect(page.getByText('자기평가를 저장했어요.')).toBeVisible();
 expect((await api.pg.query<{reflection:string}>('select reflection from sb_self_evaluations where student_id=$1',[STUDENTS[0]])).rows[0].reflection).toBe('층별로 비교했어요.');
 }finally{await api.close();}
});
