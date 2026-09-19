import {type Page} from '@playwright/test';
import {test,expect,configureLivePage} from './live-fixture';
const problem = {
  stage:'check', id:'f706d292-b923-47d9-8d0d-7087c2d81922', lesson:1, orderIndex:1, problemType:'FREE_BUILD', title:'쌓기 연습', prompt:'직접 쌓아 보세요.',
  grid:{gridWidth:4,gridDepth:4,maxHeight:4}, givenBlocks:[],startBlocks:[], given:{allowLayerView:true,allowRotate:true,minBlocks:1},choices:[],gradingMode:'exact',
};
async function setup(page:Page) {
  await configureLivePage(page);
  let saved:unknown[]=[];
  let offline=false;
  const calls:string[]=[];
  await page.addInitScript(() => { localStorage.setItem('sb.student.token', btoa(JSON.stringify({sid:'student-a',cid:'class-a'}))+'.test'); });
  await page.route('**/functions/v1/student-api',async route=>{
    const body=route.request().postDataJSON();calls.push(body.action);
    let payload:unknown={};
    if(body.action==='lessonProblems') payload={problems:[problem],seedFallback:false};
    if(body.action==='problem') payload={problem,attempt:{wrongCount:0,hintShown:false,answerRevealed:false,completed:false},hint:null,revealedAnswer:null};
    if(body.action==='snapshot:get') payload={snapshot:{blocks:saved}};
    if(body.action==='snapshot') {if(offline){await route.abort('internetdisconnected');return;}saved=body.blocks;payload={ok:true};}
    await route.fulfill({json:payload});
  });
  await page.goto('/lesson/1/solve');
  await expect(page.getByRole('button',{name:'쌓기나무 보관함. 블록을 작업판에 놓기'})).toBeEnabled();
  return {calls,getSaved:()=>saved,setOffline:(value:boolean)=>{offline=value;}};
}
test('Babylon renders; mouse drag snaps, undo/redo and saved state restore',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const state=await setup(page);
  const canvas=page.getByLabel('쌓기나무 3D 작업판');
  await page.getByRole('button',{name:'위에서 보기',exact:true}).click();
  await page.waitForTimeout(500);
  const palette=await page.getByRole('button',{name:'쌓기나무 보관함. 블록을 작업판에 놓기'}).boundingBox();
  const box=await canvas.boundingBox();
  expect(palette).not.toBeNull();expect(box).not.toBeNull();
  await page.mouse.move(palette!.x+30,palette!.y+20);await page.mouse.down();
  await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2,{steps:15});
  await expect(page.getByText('놓을 수 있어요.',{exact:true})).toBeVisible();
  await page.mouse.up();
  await expect(page.getByText('블록 수: 1',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'↶ 되돌리기'}).click();
  await expect(page.getByText('블록 수: 0',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'↷ 다시하기'}).click();
  await expect(page.getByText('블록 수: 1',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await expect.poll(()=>state.getSaved().length).toBe(1);
  await page.reload();await expect(page.getByText('블록 수: 1',{exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/babylon-desktop.png',fullPage:true});
  expect(errors).toEqual([]);
});
test('touch pointer drag places a block without orbit conflict',async({browser})=>{
  const context=await browser.newContext({baseURL:'http://127.0.0.1:4173',viewport:{width:1024,height:768},hasTouch:true});
  const page=await context.newPage();await setup(page);
  await page.getByRole('button',{name:'위에서 보기',exact:true}).click();await page.waitForTimeout(500);
  const palette=await page.getByRole('button',{name:'쌓기나무 보관함. 블록을 작업판에 놓기'}).boundingBox();
  const canvas=await page.getByLabel('쌓기나무 3D 작업판').boundingBox();
  const session=await context.newCDPSession(page);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:palette!.x+20,y:palette!.y+20}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:canvas!.x+canvas!.width/2,y:canvas!.y+canvas!.height/2}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.getByText('블록 수: 1',{exact:true})).toBeVisible();
  await context.close();
});

test('palette tap then board tap places a block', async({page})=>{
  await setup(page);
  const palette=page.getByRole('button',{name:'쌓기나무 보관함. 블록을 작업판에 놓기'});
  const canvas=page.getByLabel('쌓기나무 3D 작업판');
  await palette.click();
  const box=await canvas.boundingBox();
  expect(box).not.toBeNull();
  await canvas.click({position:{x:box!.width/2,y:box!.height/2}});
  await expect(page.getByText('블록 수: 1',{exact:true})).toBeVisible();
});

test('free rotation changes the actual canvas and does not trigger saving',async({page})=>{
  const state=await setup(page);
  const canvas=page.getByLabel('쌓기나무 3D 작업판');
  await page.getByRole('button',{name:'앞에서 보기',exact:true}).click();await page.waitForTimeout(500);
  const before=await canvas.screenshot();const box=await canvas.boundingBox();
  const calls=state.calls.length;
  await page.mouse.move(box!.x+30,box!.y+30);await page.mouse.down();await page.mouse.move(box!.x+160,box!.y+100,{steps:12});await page.mouse.up();
  await page.waitForTimeout(500);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  expect(state.calls.length).toBe(calls);
});
test('failed server save retains local draft across reload then syncs',async({page})=>{
  const state=await setup(page);state.setOffline(true);
  await page.getByText('버튼으로 놓기',{exact:true}).click();
  await page.getByRole('button',{name:'쌓기',exact:true}).click();
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('인터넷이 연결되면');
  await page.reload();await expect(page.getByText('블록 수: 1',{exact:true})).toBeVisible();
  state.setOffline(false);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect.poll(()=>state.getSaved().length).toBe(1);
});

test('lesson 5 restricts its initial camera and unlocks after answering and requesting information',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('sb.student.token','test'));
 const target={...problem,lesson:5,problemType:'CHOICE',givenBlocks:[{x:0,y:0,z:0},{x:1,y:0,z:0},{x:1,y:1,z:0}],given:{allowRotate:false},choices:['알 수 있어요','추가 정보가 필요해요']};
 await page.route('**/functions/v1/student-api',async route=>{const body=route.request().postDataJSON();const data=body.action==='lessonProblems'?{problems:[target]}:body.action==='snapshot:get'?{snapshot:null}:body.action==='attempt'?{grade:{completed:true,wrongCount:0,message:'정답',hint:null,revealedAnswer:null,xpEarned:30,stars:3}}:{problem:target,attempt:{wrongCount:0,hintShown:false,answerRevealed:false,completed:false},hint:null};await route.fulfill({json:data});});
 await page.goto('/lesson/5');const canvas=page.getByLabel('쌓기나무 3D 작업판');
 await expect(page.getByRole('button',{name:'위에서 보기',exact:true})).toBeDisabled();
 await canvas.focus();await page.waitForTimeout(600);const initial=await canvas.screenshot();const box=await canvas.boundingBox();
 const drag=async()=>{await page.mouse.move(box!.x+30,box!.y+30);await page.mouse.down();await page.mouse.move(box!.x+160,box!.y+100,{steps:10});await page.mouse.up();await page.waitForTimeout(350);};
 await drag();expect((await canvas.screenshot()).equals(initial)).toBe(true);
 await page.getByRole('button',{name:'2. 추가 정보가 필요해요'}).click();await page.getByRole('button',{name:'정답 확인',exact:true}).click();
 await page.getByRole('button',{name:'추가 정보 확인',exact:true}).click();await expect(page.getByRole('button',{name:'위에서 보기',exact:true})).toBeEnabled();
 await drag();expect((await canvas.screenshot()).equals(initial)).toBe(false);
});

test('lesson 5 restriction also blocks touch orbit while other lessons remain free',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('sb.student.token','test'));
 const target={...problem,lesson:5,problemType:'CHOICE',givenBlocks:[{x:0,y:0,z:0},{x:1,y:0,z:0}],given:{allowRotate:false},choices:['8개','알 수 없음']};
 await page.route('**/functions/v1/student-api',async route=>{const body=route.request().postDataJSON();const data=body.action==='lessonProblems'?{problems:[target]}:body.action==='snapshot:get'?{snapshot:null}:{problem:target,attempt:{wrongCount:0,hintShown:false,answerRevealed:false,completed:false},hint:null};await route.fulfill({json:data});});
 await page.goto('/lesson/5');
 const canvas=page.getByLabel('쌓기나무 3D 작업판'); await canvas.focus(); await page.waitForTimeout(600);
 const before=await canvas.screenshot(); const box=await canvas.boundingBox();
 await page.evaluate(({x,y})=>{const c=document.querySelector('canvas[aria-label="쌓기나무 3D 작업판"]')!; for(const [type,cx,cy] of [['pointerdown',x,y],['pointermove',x+140,y+60],['pointerup',x+140,y+60]] as const)c.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:42,pointerType:'touch',clientX:cx,clientY:cy,button:0}));},{x:box!.x+40,y:box!.y+40});
 expect((await canvas.screenshot()).equals(before)).toBe(true);
});

test('lesson 2 keeps camera orbit controls enabled',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('sb.student.token','test'));
 const target={...problem,lesson:2,givenBlocks:[{x:0,y:0,z:0},{x:1,y:0,z:0}],given:{allowRotate:true}};
 await page.route('**/functions/v1/student-api',async route=>{const body=route.request().postDataJSON();const data=body.action==='lessonProblems'?{problems:[target]}:body.action==='snapshot:get'?{snapshot:null}:{problem:target,attempt:{wrongCount:0,hintShown:false,answerRevealed:false,completed:false},hint:null};await route.fulfill({json:data});});
 await page.goto('/lesson/2'); const canvas=page.getByLabel('쌓기나무 3D 작업판'); await canvas.focus(); await page.waitForTimeout(600);
 const before=await canvas.screenshot(); const box=await canvas.boundingBox();
 await page.mouse.move(box!.x+40,box!.y+40); await page.mouse.down(); await page.mouse.move(box!.x+180,box!.y+100,{steps:8}); await page.mouse.up();
 expect((await canvas.screenshot()).equals(before)).toBe(false);
});
