import { test,expect,type Page } from '@playwright/test';
import { initialLesson, initialActivity, localProgressKey, type LessonState } from '../shared/progress/spatial';
import { commonProblems, practiceProblems, LESSON3_MODEL } from '../shared/problems/templates/lesson3';
import { answerForComparison } from '../shared/problems/grading/spatial';
import { mathGridToDisplayGrid } from '../shared/problems/contracts/display';
import type { AnswerState, Problem } from '../shared/problems/contracts/spatial';
const path='/student/lesson/3/redesign';
const storageKey=localProgressKey('https://spatial-qa.invalid','phase1','synthetic-student','synthetic-class');
const views={top:'위에서 보기',front:'앞에서 보기',side:'옆에서 보기'};
async function boot(page:Page,state=initialLesson(314159)) {
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.addInitScript(({state,key})=>{
  localStorage.setItem('stacking-installation-config',JSON.stringify({installationId:'phase1',supabaseUrl:'https://spatial-qa.invalid',supabasePublishableKey:'synthetic-public-key'}));
  localStorage.setItem('sb.student.token',btoa(JSON.stringify({sid:'synthetic-student',cid:'synthetic-class'}))+'.not-a-server-token');
  if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(state));
 },{state,key:storageKey});
 await page.goto(path);await expect(page.getByRole('heading',{level:1})).toHaveText('위·앞·옆으로 살펴봐요');
 await expect(page.getByText('3D 화면을 열 수 없어요.',{exact:false})).toHaveCount(0);
}
async function saved(page:Page){return page.evaluate(key=>JSON.parse(localStorage.getItem(key)!) as LessonState,storageKey);}
async function camera(page:Page,view:keyof typeof views){await page.getByRole('button',{name:views[view],exact:true}).first().click();await expect(page.getByLabel('현재 관찰 시점',{exact:true}).first()).toHaveText({top:'위',front:'앞',side:'옆(오른쪽)'}[view]);await page.waitForTimeout(350);}
async function fillAnswer(page:Page,p:Problem,a:AnswerState=answerForComparison(p)!) {
 const host=page.locator(`[data-problem-id="${p.id}"]`).getByRole('group',{name:'내 답 입력',exact:true});
 if(a.kind==='choice'&&p.answerInput.kind==='choice')await host.getByRole('button',{name:p.answerInput.choices.find(c=>c.id===a.value)!.label,exact:true}).click();
 else if(a.kind==='projection-grid')for(const [face,grid] of Object.entries(a.grids)){
  const section=host.getByRole('region',{name:`${{top:'위',front:'앞',side:'옆'}[face]} 답안`,exact:true});
  const display=mathGridToDisplayGrid(grid!);
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
test.afterEach(async({page},info)=>{await page.screenshot({path:info.outputPath('screen.png'),fullPage:true});});
test('T01 learn five distinct activities and concept summary',async({page})=>{
 await boot(page);await expect(page.getByRole('button',{name:'다음 활동',exact:true})).toBeDisabled();await camera(page,'top');await camera(page,'front');await page.getByRole('button',{name:'다음 활동',exact:true}).click();
 await camera(page,'top');await page.getByRole('region',{name:'위에서 본 자리',exact:true}).locator('.math-cell').last().click();await page.getByRole('button',{name:'다음 활동',exact:true}).click();
 for(const name of ['앞에서 본 모양','옆에서 본 모양'])await page.getByRole('region',{name,exact:true}).locator('.math-cell').first().click();await page.getByRole('button',{name:'다음 활동',exact:true}).click();
 for(const [label,view] of [['가','옆'],['나','위'],['다','앞']])await page.getByRole('group',{name:`${label}의 방향`}).getByRole('button',{name:view,exact:true}).click();
 await page.getByRole('button',{name:'연결 확인하고 시점 비교'}).click();await page.getByRole('button',{name:'다음 활동',exact:true}).click();
 await page.locator('.spatial-choices').first().getByRole('button',{name:'앞',exact:true}).click();await page.getByRole('button',{name:'예상했어요 · 쌓기 시작'}).click();await placeMouse(page);
 await expect(page.getByText(`블록 수: ${LESSON3_MODEL.length+1}`,{exact:true})).toBeVisible();await page.getByRole('button',{name:'예상과 실제 변화 비교'}).click();await expect(page.getByText(/실제: 앞/)).toBeVisible();await page.getByRole('button',{name:'다음 활동',exact:true}).click();await expect(page.getByRole('heading',{name:'개념 정리',exact:true})).toBeVisible();expect((await saved(page)).learnComplete).toBe(true);
});
test('T02 canonical camera buttons render three different views',async({page})=>{await boot(page);const captures=[];for(const face of ['top','front','side'] as const){await camera(page,face);captures.push(await page.locator('canvas').screenshot());}expect(captures[0].equals(captures[1])).toBe(false);expect(captures[1].equals(captures[2])).toBe(false);expect((await saved(page)).activities[0].views).toEqual(['top','front','side']);});
test('T03 right side reference and camera remain distinct from front',async({page})=>{await boot(page,activityState(2));await camera(page,'side');const section=page.getByRole('region',{name:'옆에서 본 모양',exact:true});const actual=await section.locator('.math-cell').evaluateAll(cells=>cells.map(c=>c.getAttribute('aria-pressed')==='true'));expect(actual).toEqual([true,false,false,true,false,true,true,true,true]);await expect(page.getByText('이 단원에서 옆은 오른쪽에서 본 모양입니다.',{exact:true})).toBeVisible();});
test('T04 top bottom row is front and click restores canonical z0',async({page})=>{await boot(page,activityState(1));await camera(page,'top');const region=page.getByRole('region',{name:'위에서 본 자리',exact:true});await region.locator('.math-cell').nth(6).click();expect((await saved(page)).activities[1].top[0][0]).toBe(true);const label=await region.locator('.math-front').boundingBox();const grid=await region.locator('.math-grid-cells').boundingBox();expect(label!.y).toBeGreaterThan(grid!.y+grid!.height);});
test('T05 full cell click changes actual submission answer',async({page})=>{const s=initialLesson(314159);s.learnComplete=true;s.section='solve';s.solveIndex=2;await boot(page,s);const p=commonProblems(s.seed)[2];const cell=page.locator('.spatial-work .math-cell').first();await cell.click({position:{x:3,y:3}});await expect(cell).toHaveAttribute('aria-pressed','true');await solve(page,p);});
test('T06 square cells at desktop and tablet sizes',async({page})=>{await boot(page,activityState(1));for(const width of [1366,1024,768]){await page.setViewportSize({width,height:768});const size=await page.locator('.math-cell').first().boundingBox();expect(size!.width).toBe(48);expect(size!.height).toBe(48);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);}});
test('T07 real mouse drag, undo, redo and blocks reload',async({page})=>{const s=activityState(4);s.activities[4].predictionConfirmed=true;await boot(page,s);await placeMouse(page);await expect(page.getByText('블록 수: 8',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Undo · 되돌리기',exact:true}).click();await expect(page.getByText('블록 수: 7',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Redo · 다시 실행',exact:true}).click();await page.reload();await expect(page.getByText('블록 수: 8',{exact:true})).toBeVisible();});
test('T08 synthetic touch drag on actual canvas',async({browser})=>{const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true});const page=await context.newPage();const s=activityState(4);s.activities[4].predictionConfirmed=true;try{await boot(page,s);await camera(page,'top');const palette=page.getByRole('button',{name:'쌓기나무 보관함. 블록을 작업판에 놓기'});await palette.scrollIntoViewIfNeeded();const a=(await palette.boundingBox())!,b=(await page.locator('canvas').boundingBox())!;const start={x:a.x+a.width/2,y:a.y+a.height/2};const end={x:b.x+b.width/2-b.height/(2*4.8*.42),y:b.y+b.height/2+b.height/(2*4.8*.42)};const session=await context.newCDPSession(page);await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});for(let i=1;i<=12;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*i/12,y:start.y+(end.y-start.y)*i/12}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(page.getByText('블록 수: 8',{exact:true})).toBeVisible();await page.screenshot({path:test.info().outputPath('touch.png'),fullPage:true});}finally{await context.close();}});
test('T09 common six then adaptive four actual input and grading',async({page})=>{const s=initialLesson(314159);s.learnComplete=true;s.section='solve';await boot(page,s);for(let i=0;i<10;i++){const current=await saved(page);const problems=[...commonProblems(s.seed),...(current.adaptive??[])];const p=problems[i];await expect(page.locator('[data-problem-id]')).toHaveAttribute('data-problem-id',p.id);await solve(page,p);if(i<9)await page.getByRole('button',{name:'다음 문제',exact:true}).click();}await expect(page.getByRole('heading',{name:'문제 풀기 10문제 완료'})).toBeVisible();});
test('T10 current problem remains after reload and stage round trip',async({page})=>{const s=initialLesson(11);s.learnComplete=true;s.section='solve';s.solveIndex=2;await boot(page,s);const id=commonProblems(s.seed)[2].id;await page.reload();await expect(page.locator('[data-problem-id]')).toHaveAttribute('data-problem-id',id);await page.getByRole('button',{name:'① 개념 배우기',exact:true}).click();await page.getByRole('button',{name:'② 문제 풀기',exact:true}).click();await expect(page.locator('[data-problem-id]')).toHaveAttribute('data-problem-id',id);});
test('T11 in-progress grid survives reload unchanged',async({page})=>{const s=initialLesson(11);s.learnComplete=true;s.section='solve';s.solveIndex=4;await boot(page,s);await page.locator('.math-cell').first().click();const before=(await saved(page)).answers;await page.reload();await expect(page.locator('.math-cell').first()).toHaveAttribute('aria-pressed','true');expect((await saved(page)).answers).toEqual(before);});
test('T12 wrong one/two/three/reveal then independent correction',async({page})=>{const s=initialLesson(11);s.learnComplete=true;s.section='solve';s.solveIndex=2;await boot(page,s);for(let i=1;i<=4;i++){await page.getByRole('button',{name:'정답 확인',exact:true}).click();const p=commonProblems(s.seed)[2];expect((await saved(page)).attempts[p.id].wrong).toBe(i);if(i<4)await expect(page.getByRole('heading',{name:'정답과 내 답 비교'})).toHaveCount(0);}await expect(page.getByRole('heading',{name:'정답과 내 답 비교'})).toBeVisible();await fillAnswer(page,commonProblems(s.seed)[2]);await page.getByRole('button',{name:'정답 확인',exact:true}).click();await expect(page.getByText('정답이에요. 잘 살펴보았어요.',{exact:true})).toBeVisible();});
test('T13 practice five full inputs complete',async({page})=>{const s=initialLesson(11);s.section='practice';s.learnComplete=true;await boot(page,s);for(const [i,p] of practiceProblems(s.seed,5).entries()){await solve(page,p);if(i<4)await page.getByRole('button',{name:'다음 문제',exact:true}).click();}await expect(page.getByRole('heading',{name:'더 풀어보기 기본 5문제 완료'})).toBeVisible();});
test('T14 legacy student login route still renders input form',async({page})=>{await boot(page);await page.goto('/?class=TEST');await expect(page.getByLabel('이름',{exact:true})).toBeVisible();await expect(page.locator('#student-pin')).toBeVisible();});
test('T15 legacy teacher login route still renders Auth form',async({page})=>{await boot(page);await page.goto('/teacher');await expect(page.getByRole('heading',{name:'교사 로그인',exact:true})).toBeVisible();await expect(page.getByLabel('이메일')).toBeVisible();await expect(page.getByLabel('비밀번호')).toBeVisible();});
