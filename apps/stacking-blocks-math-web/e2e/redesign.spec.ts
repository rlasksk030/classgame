import process from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test,expect,type Page } from '@playwright/test';
import { initialLesson, initialActivity, localProgressKey, ensureAdaptive, solveProblems, type LessonState } from '../shared/progress/spatial';
import { commonProblems, practiceProblems, LESSON3_MODEL } from '../shared/problems/templates/lesson3';
import { answerForComparison, initialAttempt } from '../shared/problems/grading/spatial';
import { projectionToDisplayGrid } from '../shared/problems/contracts/display';
import type { AnswerState, Problem } from '../shared/problems/contracts/spatial';
const path='/student/lesson/3/redesign';
const storageKey=localProgressKey('https://spatial-qa.invalid','phase1','synthetic-student','synthetic-class');
const views={top:'위에서 보기',front:'앞에서 보기',side:'옆에서 보기'};
async function capture(page:Page,name:string){const dir=join(process.env.SPATIAL_QA_OUTPUT!, 'screenshots');mkdirSync(dir,{recursive:true});await page.screenshot({path:join(dir,name+'.png'),fullPage:true});}
async function renderedCells(page:Page,face:'top'|'front'|'side'){
 const canvas=page.locator('canvas').first();const png=(await canvas.screenshot()).toString('base64');
 return page.evaluate(async ({png,face})=>{const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);const unit=c.height/(2*4.8*.42);return [0,1,2].flatMap(r=>[0,1,2].map(col=>{const d=ctx.getImageData(Math.round(c.width/2+(col-1)*unit),Math.round(c.height/2+(r-(face==='top'?1:1.5))*unit),1,1).data;return d[0]>d[2]+15;}));},{png,face});
}
async function boot(page:Page,state=initialLesson(314159)) {
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.addInitScript(({state,key})=>{
  localStorage.setItem('stacking-installation-config',JSON.stringify({installationId:'phase1',supabaseUrl:'https://spatial-qa.invalid',supabasePublishableKey:'synthetic-public-key'}));
  localStorage.setItem('sb.student.token',btoa(JSON.stringify({sid:'synthetic-student',cid:'synthetic-class'}))+'.not-a-server-token');
  if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(state));
 },{state,key:storageKey});
 await page.goto(path);await expect(page.getByRole('heading',{level:1})).toHaveText('위·앞·옆으로 살펴봐요',{timeout:15000}); // Bounded cold lazy-chunk/WebGL bootstrap; interaction assertions remain 5s.
 await expect(page.getByText('3D 화면을 열 수 없어요.',{exact:false})).toHaveCount(0);
}
async function saved(page:Page){return page.evaluate(key=>JSON.parse(localStorage.getItem(key)!) as LessonState,storageKey);}
async function camera(page:Page,view:keyof typeof views){await page.getByRole('button',{name:views[view],exact:true}).first().click();await expect(page.getByLabel('현재 관찰 시점',{exact:true}).first()).toHaveText({top:'위',front:'앞',side:'옆(오른쪽)'}[view]);await page.waitForTimeout(350);}
async function fillAnswer(page:Page,p:Problem,a:AnswerState=answerForComparison(p)!) {
 const host=page.locator(`[data-problem-id="${p.id}"]`).getByRole('group',{name:'내 답 입력',exact:true});
 if(a.kind==='choice'&&p.answerInput.kind==='choice')await host.getByRole('button',{name:p.answerInput.choices.find(c=>c.id===a.value)!.label,exact:true}).click();
 else if(a.kind==='projection-grid')for(const [face,grid] of Object.entries(a.grids)){
  const section=host.getByRole('region',{name:`${{top:'위',front:'앞',side:'옆'}[face]} 답안`,exact:true});
  const display=projectionToDisplayGrid(grid!,face as 'top'|'front'|'side');
  for(let r=0;r<display.length;r++)for(let c=0;c<display[r].length;c++){
   const cell=section.locator('.math-cell').nth(r*display[r].length+c);
   await expect(cell).toBeVisible();if((await cell.getAttribute('aria-pressed')==='true')!==display[r][c])await cell.click();
  }
 }else throw new Error('This browser solver must implement the input contract');
}
async function solve(page:Page,p:Problem){await fillAnswer(page,p);await page.getByRole('button',{name:'정답 확인',exact:true}).click();await expect(page.getByText('정답이에요. 잘 살펴보았어요.',{exact:true})).toBeVisible();const s=await saved(page);expect(s.attempts[p.id]?.completed).toBe(true);expect(s.attempts[p.id]?.submitted).toEqual(answerForComparison(p));}
function activityState(index:number){const s=initialLesson(314159);s.activity=index;s.activities[index]=initialActivity();return s;}
async function placeMouse(page:Page,x=0,z=0){
 await camera(page,'top');const canvas=page.locator('canvas').first();await canvas.scrollIntoViewIfNeeded();
 const box=(await canvas.boundingBox())!;
 // Orthographic camera is centred on the 3x3 board. Scale comes from its documented half-span 4.8*.42.
 const unit=box.height/(2*4.8*.42);const end={x:box.x+box.width/2+(x-1)*unit,y:box.y+box.height/2+(1-z)*unit};
 const palette=page.getByRole('button',{name:'쌓기나무 보관함. 블록을 작업판에 놓기'});await palette.scrollIntoViewIfNeeded();
 const start=(await palette.boundingBox())!;const adjusted=(await canvas.boundingBox())!;end.y+=adjusted.y-box.y;
 await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:16});await page.mouse.up();
}
test.beforeAll(async({browser})=>{writeFileSync(join(process.env.SPATIAL_QA_OUTPUT!,'browser-environment.json'),JSON.stringify({browser:'Chromium',version:browser.version(),platform:process.platform,node:process.version,baseURL:'http://127.0.0.1:4186',viewports:[[1366,768],[1024,768],[768,768]],touch:'CDP synthetic touch; not physical iPad',category:'UI_WITH_TEST_DATA'},null,2));});
test.afterEach(async({page},info)=>{if(page.url()==='about:blank')return;await page.screenshot({path:info.outputPath('screen.png'),fullPage:true});});
test('T01 learn five distinct activities and concept summary',async({page})=>{
 test.setTimeout(180000); // Five complete activities plus explicit screenshot evidence; assertions still use 5s waits.
 await boot(page);await capture(page,'learn-1');await expect(page.getByRole('button',{name:'다음 활동',exact:true})).toBeDisabled();await camera(page,'top');await camera(page,'front');await page.getByRole('button',{name:'다음 활동',exact:true}).click();
 await camera(page,'top');await page.getByRole('region',{name:'위에서 본 자리',exact:true}).locator('.math-cell').last().click();await page.getByRole('button',{name:'다음 활동',exact:true}).click();
 await capture(page,'learn-3');
 for(const name of ['앞에서 본 모양','옆에서 본 모양'])await page.getByRole('region',{name,exact:true}).locator('.math-cell').first().click();await page.getByRole('button',{name:'다음 활동',exact:true}).click();
 for(const [label,view] of [['가','옆'],['나','위'],['다','앞']])await page.getByRole('group',{name:`${label}의 방향`}).getByRole('button',{name:view,exact:true}).click();
 await expect(page.getByRole('region',{name:'가',exact:true}).locator('.math-cell').first()).toHaveAttribute('aria-pressed','false');
 await page.getByRole('button',{name:'연결 확인하고 시점 비교'}).click();await page.getByRole('button',{name:'다음 활동',exact:true}).click();
 await capture(page,'learn-5');
 await page.locator('.spatial-choices').first().getByRole('button',{name:'앞',exact:true}).click();await page.getByRole('button',{name:'예상했어요 · 쌓기 시작'}).click();await placeMouse(page);
 await expect(page.getByText(`블록 수: ${LESSON3_MODEL.length+1}`,{exact:true})).toBeVisible();await page.getByRole('button',{name:'예상과 실제 변화 비교'}).click();await expect(page.getByText(/실제: 앞/)).toBeVisible();await page.getByRole('button',{name:'다음 활동',exact:true}).click();await expect(page.getByRole('heading',{name:'개념 정리',exact:true})).toBeVisible();expect((await saved(page)).learnComplete).toBe(true);
});
test('T02 canonical camera buttons render three different views',async({page})=>{await boot(page);const captures=[];for(const face of ['top','front','side'] as const){await camera(page,face);captures.push(await page.locator('canvas').screenshot());expect(await renderedCells(page,face)).toEqual({top:[false,false,true,false,true,false,true,true,false],front:[false,false,true,false,true,true,true,true,true],side:[false,false,true,true,false,true,true,true,true]}[face]);await capture(page,`view-${face}`);}expect(captures[0].equals(captures[1])).toBe(false);expect(captures[1].equals(captures[2])).toBe(false);expect((await saved(page)).activities[0].views).toEqual(['top','front','side']);});
test('T03 right side reference matches actual asymmetric camera image',async({page})=>{
 await boot(page,activityState(2));await camera(page,'side');
 const pixels=await renderedCells(page,'side');
 // Independently observed from +X: z=0 is screen left. Column heights are 2,1,3.
 const expected=[false,false,true,true,false,true,true,true,true];expect(pixels).toEqual(expected);
 const actual=await page.getByRole('region',{name:'옆에서 본 모양',exact:true}).locator('.math-cell').evaluateAll(cells=>cells.map(c=>c.getAttribute('aria-pressed')==='true'));
 expect(actual).toEqual(expected);await capture(page,'right-side-matches-reference');
 await expect(page.getByText('이 단원에서 옆은 오른쪽에서 본 모양입니다.',{exact:true})).toBeVisible();
});
test('T04 top bottom row is front and click restores canonical z0',async({page})=>{await boot(page,activityState(1));await camera(page,'top');const region=page.getByRole('region',{name:'위에서 본 자리',exact:true});await region.locator('.math-cell').nth(6).click();expect((await saved(page)).activities[1].top[0][0]).toBe(true);const label=await region.locator('.math-front').boundingBox();const grid=await region.locator('.math-grid-cells').boundingBox();expect(label!.y).toBeGreaterThan(grid!.y+grid!.height);await capture(page,'top-projection');});
test('T05 full cell click changes actual submission answer',async({page})=>{const s=initialLesson(314159);s.learnComplete=true;s.section='solve';s.solveIndex=2;await boot(page,s);const p=commonProblems(s.seed)[2];const cell=page.locator('.spatial-work .math-cell').first();for(const [position,pressed] of [[{x:24,y:24},'true'],[{x:3,y:3},'false'],[{x:44,y:44},'true']] as const){await cell.click({position});await expect(cell).toHaveAttribute('aria-pressed',pressed);}await solve(page,p);});
test('T06 square cells at desktop and tablet sizes',async({page})=>{await boot(page,activityState(1));for(const width of [1366,1024,768]){await page.setViewportSize({width,height:768});const size=await page.locator('.math-cell').first().boundingBox();expect(size!.width).toBe(48);expect(size!.height).toBe(48);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);}});
test('T07 real mouse drag, undo, redo and blocks reload',async({page})=>{const s=activityState(4);s.activities[4].predictionConfirmed=true;await boot(page,s);await placeMouse(page);await expect(page.getByText('블록 수: 8',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Undo · 되돌리기',exact:true}).click();await expect(page.getByText('블록 수: 7',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Redo · 다시 실행',exact:true}).click();
 await camera(page,'top');const canvas=page.locator('canvas');await canvas.scrollIntoViewIfNeeded();const b=(await canvas.boundingBox())!;const u=b.height/(2*4.8*.42);
 await page.mouse.click(b.x+b.width/2-u,b.y+b.height/2+u);
 await page.getByRole('button',{name:'선택 블록 삭제',exact:true}).click();await expect(page.getByText('블록 수: 7',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Undo · 되돌리기',exact:true}).click();await expect(page.getByText('블록 수: 8',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Redo · 다시 실행',exact:true}).click();await expect(page.getByText('블록 수: 7',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Undo · 되돌리기',exact:true}).click();await page.reload();await expect(page.getByText('블록 수: 8',{exact:true})).toBeVisible();await capture(page,'mouse-builder-restored');});
test('T08 synthetic touch drag on actual canvas',async({browser})=>{const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true});const page=await context.newPage();const s=activityState(4);s.activities[4].predictionConfirmed=true;try{await boot(page,s);await camera(page,'top');const palette=page.getByRole('button',{name:'쌓기나무 보관함. 블록을 작업판에 놓기'});await palette.scrollIntoViewIfNeeded();const a=(await palette.boundingBox())!,b=(await page.locator('canvas').boundingBox())!;const start={x:a.x+a.width/2,y:a.y+a.height/2};const end={x:b.x+b.width/2-b.height/(2*4.8*.42),y:b.y+b.height/2+b.height/(2*4.8*.42)};const session=await context.newCDPSession(page);await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});for(let i=1;i<=12;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*i/12,y:start.y+(end.y-start.y)*i/12}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(page.getByText('블록 수: 8',{exact:true})).toBeVisible();await page.screenshot({path:test.info().outputPath('touch.png'),fullPage:true});}catch(error){await page.screenshot({path:test.info().outputPath('touch-failure.png'),fullPage:true});throw error;}finally{await context.close();}});
test('T09 common six then adaptive four actual input and grading',async({page})=>{test.setTimeout(180000); // Ten full submissions and named screenshots, with unchanged per-assertion waits.
const s=initialLesson(314159);s.learnComplete=true;s.section='solve';await boot(page,s);for(let i=0;i<10;i++){const current=await saved(page);const problems=[...commonProblems(s.seed),...(current.adaptive??[])];const p=problems[i];await expect(page.locator('[data-problem-id]')).toHaveAttribute('data-problem-id',p.id);if(i===2)await capture(page,'solve-grid');if(i===6)await capture(page,'solve-two-3d-models');await solve(page,p);if(i<9)await page.getByRole('button',{name:'다음 문제',exact:true}).click();}await expect(page.getByRole('heading',{name:'문제 풀기 10문제 완료'})).toBeVisible();await page.getByRole('button',{name:'더 풀어보기 시작',exact:true}).click();await expect(page.locator('[data-problem-id]')).toHaveAttribute('data-problem-id',practiceProblems(s.seed,5)[0].id);});
test('T10 current problem remains after reload and stage round trip',async({page})=>{const s=initialLesson(11);s.learnComplete=true;s.section='solve';s.solveIndex=4;await boot(page,s);const id=commonProblems(s.seed)[4].id;await page.reload();await expect(page.locator('[data-problem-id]')).toHaveAttribute('data-problem-id',id);await page.getByRole('button',{name:'① 개념 배우기',exact:true}).click();await page.getByRole('button',{name:'② 문제 풀기',exact:true}).click();await expect(page.locator('[data-problem-id]')).toHaveAttribute('data-problem-id',id);});
test('T11 in-progress grid survives reload unchanged',async({page})=>{const s=initialLesson(11);s.learnComplete=true;s.section='solve';s.solveIndex=4;await boot(page,s);await page.locator('.math-cell').first().click();const before=(await saved(page)).answers;await page.reload();await expect(page.locator('.math-cell').first()).toHaveAttribute('aria-pressed','true');expect((await saved(page)).answers).toEqual(before);});
test('T12 wrong one/two/three/reveal then independent correction',async({page})=>{const s=initialLesson(11);s.learnComplete=true;s.section='solve';s.solveIndex=2;await boot(page,s);for(let i=1;i<=4;i++){await page.getByRole('button',{name:'정답 확인',exact:true}).click();const p=commonProblems(s.seed)[2];expect((await saved(page)).attempts[p.id].wrong).toBe(i);if(i<4)await expect(page.getByRole('heading',{name:'정답과 내 답 비교'})).toHaveCount(0);
 if(i===1)await expect(page.locator('.spatial-feedback')).toHaveText(p.feedbackPolicy.first);
 if(i===2){await expect(page.locator('.spatial-feedback')).toContainText('파란 블록');await expect(page.getByLabel('현재 관찰 시점',{exact:true})).toHaveText('위');await capture(page,'feedback-highlight');}
 if(i===3)await expect(page.locator('.spatial-feedback')).toHaveText(`힌트: ${p.feedbackPolicy.hint}`);
 await expect(page.locator('[data-problem-id]')).toHaveAttribute('data-problem-id',p.id);}await expect(page.getByRole('heading',{name:'정답과 내 답 비교'})).toBeVisible();await capture(page,'feedback-answer-comparison');await fillAnswer(page,commonProblems(s.seed)[2]);await page.getByRole('button',{name:'정답 확인',exact:true}).click();await expect(page.getByText('정답이에요. 잘 살펴보았어요.',{exact:true})).toBeVisible();});
test('T13 practice five full inputs complete',async({page})=>{let s=initialLesson(11);s.learnComplete=true;for(const p of commonProblems(s.seed))s.attempts[p.id]={...initialAttempt(),completed:true};s=ensureAdaptive(s);for(const p of solveProblems(s))s.attempts[p.id]={...initialAttempt(),completed:true};s.section='practice';await boot(page,s);await expect(page.getByRole('button',{name:'③ 더 풀어보기',exact:true})).toBeEnabled();for(const [i,p] of practiceProblems(s.seed,5).entries()){await solve(page,p);if(i<4)await page.getByRole('button',{name:'다음 문제',exact:true}).click();}await expect(page.getByRole('heading',{name:'더 풀어보기 기본 5문제 완료'})).toBeVisible();await capture(page,'practice-complete');await page.getByRole('button',{name:'새 문제 5개 더 풀기'}).click();await expect(page.locator('[data-problem-id]')).toHaveAttribute('data-problem-id',practiceProblems(s.seed,10)[5].id);await expect(page.getByRole('heading',{level:2,name:/^더 풀어보기 6\/10/})).toBeVisible();});
test('T14 legacy student login route still renders input form',async({page})=>{await boot(page);await page.goto('/?class=TEST');await expect(page.getByLabel('이름',{exact:true})).toBeVisible();await expect(page.locator('#student-pin')).toBeVisible();});
test('T15 legacy teacher login route still renders Auth form',async({page})=>{await boot(page);await page.goto('/teacher');await expect(page.getByRole('heading',{name:'교사 로그인',exact:true})).toBeVisible();await expect(page.getByLabel('이메일')).toBeVisible();await expect(page.getByLabel('비밀번호')).toBeVisible();});

test('R16 legacy ProjectionGrid floor display and click coordinates',async({page})=>{
 await boot(page);
 const projection=[[true,false],[false,true]];
 const problem={id:'phase1b-legacy-grid',lesson:3,orderIndex:1,stage:'check',problemType:'PROJECTION_DRAW',title:'기존 위 격자 회귀',prompt:'위에서 본 모양을 그려 보세요.',grid:{gridWidth:2,gridDepth:2,maxHeight:2},givenBlocks:[{x:0,y:0,z:0},{x:1,y:0,z:1}],startBlocks:[],choices:[],difficulty:1,xp:10,
  given:{projections:{top:projection},allowRotate:true},presentation:{visibleRepresentations:['MODEL_3D','TOP_VIEW'],cameraPolicy:{mode:'FREE'},answerInput:'GRID',gridSpecs:{top:{rows:2,cols:2}},instructions:[]}};
 let submitted:unknown=null;
 await page.route('**/functions/v1/student-api',async route=>{
  const body=route.request().postDataJSON();
  if(body.action==='attempt')submitted=body.submission;
  const payload=body.action==='lessonProblems'?{problems:[problem],requiredComplete:false,currentProblemId:null}:
   body.action==='problem'?{problem,attempt:{wrongCount:0,hintShown:false,answerRevealed:false,completed:false},hint:null,revealedAnswer:null}:
   body.action==='snapshot:get'?{snapshot:null}:
   body.action==='attempt'?{grade:{correct:false,completed:false,wrongCount:1,message:'다시 살펴보세요.',hint:null,revealedAnswer:null,xpEarned:0,stars:0}}:{ok:true};
  await route.fulfill({json:payload});
 });
 await page.goto('/lesson/3/solve');
 const answer=page.locator('[data-answer-renderer="SingleGridRenderer"]');await expect(answer).toBeVisible();
 const grid=answer.locator('table.projection-table');const cells=grid.locator('button.cell-btn');await expect(cells).toHaveCount(4);
 await expect(cells.nth(2)).toHaveAttribute('aria-label',/1행 1열$/);await expect(cells.nth(0)).toHaveAttribute('aria-label',/2행 1열$/);
 const before=(await grid.boundingBox())!;const front=(await answer.locator('.projection-label-front').boundingBox())!;expect(front.y).toBeGreaterThanOrEqual(before.y+before.height);
 const side=(await answer.locator('.projection-label-side').boundingBox())!;expect(side.x).toBeGreaterThanOrEqual(before.x+before.width);
 await cells.nth(2).click();await expect(cells.nth(2)).toHaveAttribute('aria-pressed','true');await page.getByRole('button',{name:'정답 확인',exact:true}).click();
 await expect.poll(()=>submitted).toEqual({kind:'projections',projections:{top:[[true,false],[false,false]]}});
 await capture(page,'legacy-projection-grid');
});
