import {test,expect,type Page,type Locator} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import process from 'node:process';
import {initialLesson,localProgressKey,type LessonState} from '../shared/progress/spatial';
import {phase3Activities,phase3Practice,lesson5Problem,lesson6Problem,middleLayerProblem,type Phase3Lesson} from '../shared/problems/templates/phase3';
import {phase3Solve,phase3Total} from '../shared/progress/phase3';
import {answerForComparison,gradeSpatial} from '../shared/problems/grading/spatial';
import {projectionToDisplayGrid} from '../shared/problems/contracts/display';
import {fromHeightMap} from '../shared/blocks';
import type {Problem,AnswerState} from '../shared/problems/contracts/spatial';
const key=(id:Phase3Lesson)=>localProgressKey('https://spatial-qa.invalid','phase3','synthetic-student','synthetic-class').replace(/lesson3$/,`lesson${id}:phase3-v1`);
async function boot(page:Page,id:Phase3Lesson,state=initialLesson(314159)){
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.addInitScript(({state,key})=>{localStorage.setItem('stacking-installation-config',JSON.stringify({installationId:'phase3',supabaseUrl:'https://spatial-qa.invalid',supabasePublishableKey:'synthetic-public-key'}));localStorage.setItem('sb.student.token',btoa(JSON.stringify({sid:'synthetic-student',cid:'synthetic-class'}))+'.not-a-server-token');if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(state));},{state,key:key(id)});
 await page.goto(`/student/lesson/${id}/redesign`);await expect(page.locator('[data-problem-id]')).toBeVisible({timeout:15000});
}
const saved=(page:Page,id:Phase3Lesson)=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)!) as LessonState,key(id));
const click=(page:Page,name:string)=>page.getByRole('button',{name,exact:true}).click();
async function shot(page:Page,name:string){const dir=join(process.env.SPATIAL_QA_OUTPUT!,'screenshots');mkdirSync(dir,{recursive:true});await page.screenshot({path:join(dir,name+'.png'),fullPage:true});}
async function gridFill(region:Locator,rows:(boolean|number)[][],face?:'top'|'front'|'side'){
 const cells=region.locator('.math-cell'),display=projectionToDisplayGrid(rows,face).flat();await expect(cells).toHaveCount(display.length);
 for(let i=0;i<display.length;i++){const cell=cells.nth(i);await expect(cell).toBeVisible();if(typeof display[i]==='number')await cell.fill(String(display[i]));else if((await cell.getAttribute('aria-pressed')==='true')!==display[i])await cell.click();}
}
async function fill(page:Page,p:Problem,answer=answerForComparison(p)!){
 const host=page.getByRole('group',{name:'내 답 입력',exact:true});
 if(answer.kind==='choice'&&p.answerInput.kind==='choice')await host.getByRole('button',{name:p.answerInput.choices.find(c=>c.id===answer.value)!.label,exact:true}).click();
 else if(answer.kind==='boolean-judgment'&&p.answerInput.kind==='boolean-judgment'){await expect(host.getByRole('spinbutton')).toHaveCount(0);await host.getByRole('button',{name:answer.value?p.answerInput.yesLabel:p.answerInput.noLabel,exact:true}).click();}
 else if(answer.kind==='number')await host.getByRole('spinbutton').fill(String(answer.value));
 else if(answer.kind==='height-map')await gridFill(host,answer.grid);
 else if(answer.kind==='projection-grid'){for(const [face,rows]of Object.entries(answer.grids)){const title=face==='front'?'앞 답안':face==='side'?'옆 답안':'위 답안';await gridFill(host.getByRole('region',{name:title,exact:true}),rows,face as 'top'|'front'|'side');}}
 else if(answer.kind==='layer-map')for(let l=0;l<answer.grids.length;l++)await gridFill(host.getByRole('region',{name:`${l+1}층 답안`,exact:true}),answer.grids[l]);
 else if(answer.kind==='block-builder'){
  await expect(host.locator('canvas')).toBeVisible();
  const draft=(await saved(page,p.lessonId as Phase3Lesson)).answers[p.id];let existing=draft?.kind==='block-builder'?draft.blocks:[];
  const contains=(b:{x:number;y:number;z:number})=>answer.blocks.some(v=>v.x===b.x&&v.y===b.y&&v.z===b.z);
  if(existing.some(b=>!contains(b))){page.once('dialog',d=>d.accept());await host.getByRole('button',{name:'전체 초기화',exact:true}).click();existing=[];}

  const details=host.locator('details').filter({has:page.locator('summary',{hasText:'버튼으로 놓기'})});if(await details.getAttribute('open')===null)await details.locator('summary').click();
  for(const b of answer.blocks.filter(b=>!existing.some(v=>v.x===b.x&&v.y===b.y&&v.z===b.z)).sort((a,b)=>a.y-b.y||a.z-b.z||a.x-b.x)){await details.getByLabel('가로').fill(String(b.x+1));await details.getByLabel('세로').fill(String(b.z+1));await details.getByRole('button',{name:'쌓기',exact:true}).click();}
  await expect(host.getByText(`쌓기나무 ${answer.blocks.length}개`,{exact:true})).toBeVisible();
 }else throw new Error(`Unsupported browser answer: ${answer.kind}`);
}
async function grade(page:Page,id:Phase3Lesson,p:Problem,learn=false,a?:AnswerState){await fill(page,p,a);await click(page,learn?'활동 확인':'정답 확인');await expect(page.getByText('정답이에요. 조건을 잘 확인했어요.',{exact:true})).toBeVisible();expect((await saved(page,id)).attempts[p.id].submitted).toEqual(a??answerForComparison(p));}
async function flow(page:Page,id:Phase3Lesson){
 await boot(page,id);const activities=phase3Activities(id);
 for(const [i,a]of activities.entries()){
  await expect(page.locator('[data-activity-id]')).toHaveAttribute('data-activity-id',`l${id}-activity-${i+1}`);await expect(page.getByRole('button',{name:'다음 활동',exact:true})).toBeDisabled();
  if((id===6||id===8)&&i>0&&i<3){const draft=(await saved(page,id)).answers[a.problem.id];expect(draft?.kind).toBe('block-builder');if(draft?.kind==='block-builder')expect(draft.blocks.length).toBeGreaterThan(0);}
  if(id===5&&i===0){const canvas=page.getByRole('group',{name:'내 답 입력',exact:true}).locator('canvas');await canvas.scrollIntoViewIfNeeded();await page.waitForTimeout(500);const before=await canvas.screenshot(),box=(await canvas.boundingBox())!;await page.mouse.move(box.x+15,box.y+15);await page.mouse.down();await page.mouse.move(box.x+65,box.y+30,{steps:10});await page.mouse.up();await page.waitForTimeout(100);expect((await canvas.screenshot()).equals(before)).toBe(true);await shot(page,'l5-fixed-oblique');}
  await grade(page,id,a.problem,true);if(i===2){const before=await saved(page,id);await page.reload();expect((await saved(page,id)).answers).toEqual(before.answers);await expect(page.locator('[data-activity-id]')).toHaveAttribute('data-activity-id',`l${id}-activity-3`);}
  if(i===1||i===4)await shot(page,`l${id}-learn-${i+1}`);await click(page,'다음 활동');
 }
 await click(page,'문제 풀기 시작');
 for(let i=0;i<phase3Total(id);i++){
  const p=phase3Solve(id,await saved(page,id))[i];await expect(page.locator('[data-problem-id]')).toHaveAttribute('data-problem-id',p.id);await grade(page,id,p);
  if(i===2){await click(page,'① 개념 배우기');await click(page,'② 문제 풀기');await expect(page.locator('[data-problem-id]')).toHaveAttribute('data-problem-id',p.id);await page.reload();await expect(page.locator('[data-problem-id]')).toHaveAttribute('data-problem-id',p.id);}
  if(i===4)await shot(page,`l${id}-solve`);if(i<phase3Total(id)-1)await click(page,'다음 문제');
 }
 await expect(page.getByRole('heading',{name:`문제 풀기 ${phase3Total(id)}문제 완료`,exact:true})).toBeVisible();await click(page,'더 풀어보기 시작');
 for(const [i,p]of phase3Practice(id,314159).entries()){await expect(page.locator('[data-problem-id]')).toHaveAttribute('data-problem-id',p.id);await grade(page,id,p);if(i<4)await click(page,'다음 문제');}
 await expect(page.getByRole('heading',{name:'더 풀어보기 기본 5문제 완료',exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('heading',{name:'더 풀어보기 기본 5문제 완료',exact:true})).toBeVisible();await shot(page,`l${id}-complete`);
}
test.afterEach(async({page},info)=>{if(page.url()!=='about:blank')await page.screenshot({path:info.outputPath('phase3-screen.png'),fullPage:true});});
test('P35 L5 five Learn ten Solve five Practice with restore',async({page})=>{test.setTimeout(300000);await flow(page,5);});
test('P36 L6 five Learn ten Solve five Practice with restore',async({page})=>{test.setTimeout(300000);await flow(page,6);});
test('P37 L7 five Learn nine Solve five Practice with restore',async({page})=>{test.setTimeout(300000);await flow(page,7);});
test('P38 L8 five Learn nine Solve five Practice with restore',async({page})=>{test.setTimeout(300000);await flow(page,8);});
test('P39 four wrong attempts reveal number, not builder; position and draft survive',async({page})=>{const s=initialLesson(314159);s.learnComplete=true;s.section='solve';s.solveIndex=5;await boot(page,5,s);const p=lesson5Problem(s.seed+5,'solve',5);for(let n=1;n<=4;n++){await fill(page,p,{kind:'number',value:99});await click(page,'정답 확인');expect((await saved(page,5)).attempts[p.id].wrong).toBe(n);if(n===3){await expect(page.getByText(/^힌트:/)).toBeVisible();await expect(page.getByRole('heading',{name:'정답과 이유',exact:true})).toHaveCount(0);}}await expect(page.getByRole('heading',{name:'정답과 이유',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'정답 예시'}).getByRole('spinbutton')).toHaveValue('3');await expect(page.getByText('작업판에서 조건을 만족하도록 다시 쌓아 보세요.',{exact:true})).toHaveCount(0);await page.reload();await expect(page.locator('[data-problem-id]')).toHaveAttribute('data-problem-id',p.id);await grade(page,5,p);});
test('P40 alternative 3D answer, real example reveal and middle-layer restore',async({page})=>{const s=initialLesson(314159);s.learnComplete=true;s.section='solve';s.solveIndex=1;await boot(page,6,s);const p=lesson6Problem(s.seed+1,'solve',1);for(let i=0;i<4;i++)await click(page,'정답 확인');await expect(page.getByRole('heading',{name:'가능한 모양 중 하나',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'정답 예시'}).locator('canvas')).toBeVisible();const alt={kind:'block-builder' as const,blocks:fromHeightMap([[2,2],[2,2]])};expect(gradeSpatial(p,alt)).toBe('correct');await grade(page,6,p,false,alt);await shot(page,'l6-alternative-reveal');});
test('P41 mouse palette drag and tablet touch placement are real input',async({browser})=>{const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true});const page=await context.newPage();try{await boot(page,6);const host=page.getByRole('group',{name:'내 답 입력',exact:true});await host.getByRole('button',{name:'위에서 보기',exact:true}).click();await expect(host.getByLabel('현재 관찰 시점',{exact:true})).toHaveText('위');await page.waitForTimeout(450);const palette=host.getByRole('button',{name:'쌓기나무 보관함. 블록을 작업판에 놓기'});await palette.scrollIntoViewIfNeeded();const a=(await palette.boundingBox())!,b=(await host.locator('canvas').boundingBox())!,unit=b.height/(2*4.8*.42),end={x:b.x+b.width/2-unit*.5,y:b.y+b.height/2+unit*.5};await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:16});await page.mouse.up();await expect(host.getByText('쌓기나무 1개',{exact:true})).toBeVisible();const session=await context.newCDPSession(page),start={x:a.x+a.width/2,y:a.y+a.height/2},dest={x:end.x+unit,y:end.y};await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});for(let i=1;i<=12;i++)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(dest.x-start.x)*i/12,y:start.y+(dest.y-start.y)*i/12}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(host.getByText('쌓기나무 2개',{exact:true})).toBeVisible();await palette.tap();await page.touchscreen.tap(end.x,end.y-unit);await expect(host.getByText('쌓기나무 3개',{exact:true})).toBeVisible();await shot(page,'l6-tablet-input');}finally{await context.close();}});
test('P42 optional practice middle layer has a unique answer and restores cells',async({page})=>{const s=initialLesson(314159);s.learnComplete=true;s.section='practice';s.practiceCount=10;s.practiceIndex=5;await boot(page,8,s);const p=middleLayerProblem();await fill(page,p);const before=(await saved(page,8)).answers[p.id];await page.reload();expect((await saved(page,8)).answers[p.id]).toEqual(before);await grade(page,8,p);await shot(page,'l8-middle-layer');});
test('P43 unfinished answer kinds restore after reload without completing or moving',async({browser})=>{test.setTimeout(180000);for(const [id,index]of [[5,1],[5,5],[6,0],[6,1],[7,4],[8,2],[8,3]] as [Phase3Lesson,number][]){const context=await browser.newContext();try{const page=await context.newPage(),s=initialLesson(314159);s.section='solve';s.learnComplete=true;s.solveIndex=index;await boot(page,id,s);const p=phase3Solve(id,s)[index];await fill(page,p);const draft=(await saved(page,id)).answers[p.id];await page.reload();await expect(page.locator('[data-problem-id]')).toHaveAttribute('data-problem-id',p.id);expect((await saved(page,id)).answers[p.id]).toEqual(draft);expect((await saved(page,id)).attempts[p.id]?.completed??false).toBe(false);await click(page,'정답 확인');await expect(page.getByText('정답이에요. 조건을 잘 확인했어요.',{exact:true})).toBeVisible();}finally{await context.close();}}});
test('P44 L5 both sufficient and insufficient information use judgment buttons',async({browser})=>{for(const seed of [0,1]){const context=await browser.newContext();try{const page=await context.newPage(),s=initialLesson(seed);s.section='solve';s.learnComplete=true;s.solveIndex=1;await boot(page,5,s);const p=phase3Solve(5,s)[1];await expect(page.getByRole('group',{name:'내 답 입력',exact:true}).getByRole('spinbutton')).toHaveCount(0);await grade(page,5,p);expect(p.gradingPolicy.kind==='determinability'&&p.gradingPolicy.determinable).toBe(seed===0);await shot(page,`l5-${seed===0?'sufficient':'insufficient'}`);}finally{await context.close();}}});
