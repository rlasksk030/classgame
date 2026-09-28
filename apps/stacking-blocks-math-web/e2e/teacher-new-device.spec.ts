import { test, expect } from '@playwright/test';
import { encodeInstallationConfig } from '../src/lib/config';
const config = { installationId: 'teacher-e2e', supabaseUrl: 'https://teacher-e2e.supabase.co', supabasePublishableKey: 'sb_publishable_fixture' };

test('fresh device sees reconnect, OAuth round trip, explicit project selection and teacher login', async ({page}) => {
  let granted = false;
  const mutations: string[] = [];
  await page.route('**/api/installer/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if(path.endsWith('/authorize')) { granted=true; return route.fulfill({json:{authorizeUrl:'http://127.0.0.1:4173/setup?oauth=granted'}}); }
    if(path.endsWith('/projects')) return route.fulfill(granted ? {json:{projects:[{ref:'teacher-e2e',name:'기존 수업 프로젝트'}]}} : {status:401,json:{code:'INSTALLER_AUTH_REQUIRED'}});
    mutations.push(path);
    if(path.endsWith('/session')) return route.fulfill({json:{publishableKey:config.supabasePublishableKey}});
    return route.fulfill({status:500,json:{code:'UNEXPECTED_REQUEST'}});
  });
  await page.goto('/teacher');
  await expect(page.getByText('이 기기에서는 아직 수업앱 연결이 되어 있지 않습니다.')).toBeVisible();
  await expect(page.getByText('SUPABASE_CONFIG_ERROR')).toHaveCount(0);
  await page.getByRole('link',{name:'기존 수업앱 연결하기'}).click();
  await expect(page).toHaveURL(/setup\?returnTo=%2Fteacher/);
  await page.getByRole('button',{name:'Supabase 연결',exact:true}).click();
  await expect(page.getByLabel('내 Supabase 프로젝트')).toBeVisible();
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByRole('button',{name:'이 프로젝트 사용'}).click();
  await expect(page).toHaveURL(/\/teacher$/);
  await expect(page.getByRole('heading',{name:'교사 로그인'})).toBeVisible();
  expect(mutations).toEqual(['/api/installer/session']);
  await page.reload();
  await expect(page.getByRole('heading',{name:'교사 로그인'})).toBeVisible();
});

test('shared teacher link connects a clean context and persists after reload',async({page})=>{
  await page.goto(`/teacher#install=${encodeInstallationConfig(config)}`);
  await expect(page.getByRole('heading',{name:'교사 로그인'})).toBeVisible();
  await page.goto('/teacher');
  await expect(page.getByRole('heading',{name:'교사 로그인'})).toBeVisible();
  expect(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('stacking-installation-config')!)).sort())).toEqual(['installationId','supabasePublishableKey','supabaseUrl']);
});

test('bad install shows friendly guidance without overwriting an existing installation',async({page})=>{
  await page.addInitScript(value=>localStorage.setItem('stacking-installation-config',JSON.stringify(value)),config);
  await page.goto('/teacher#install=bad');
  await expect(page.getByText('접속 링크의 연결 정보가 올바르지 않습니다. 기존 수업앱을 다시 연결해 주세요.')).toBeVisible();
  await expect(page.getByText('SUPABASE_CONFIG_ERROR')).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('stacking-installation-config')!))).toEqual(config);
});

test('existing installed context still opens teacher login directly',async({page})=>{
  await page.addInitScript(value=>localStorage.setItem('stacking-installation-config',JSON.stringify(value)),config);
  await page.goto('/teacher');
  await expect(page.getByRole('heading',{name:'교사 로그인'})).toBeVisible();
  await expect(page.getByRole('link',{name:'기존 수업앱 연결하기'})).toHaveCount(0);
});

test('malicious return URL does not leave the application',async({page})=>{
  await page.route('**/api/installer/**',route=>route.fulfill({status:401,json:{code:'INSTALLER_AUTH_REQUIRED'}}));
  await page.goto('/setup?returnTo=https%3A%2F%2Fevil.invalid');
  await expect(page.getByRole('heading',{name:'공간과 입체 수업앱 설치'})).toBeVisible();
  expect(await page.evaluate(()=>sessionStorage.getItem('stacking-teacher-return'))).toBeNull();
});

test('authenticated teacher loads existing class and student and shares only public connection fields',async({page,context,browserName})=>{
  const key = 'sb-teacher-e2e-auth-token';
  const session = { access_token: 'fixture-teacher-token', refresh_token: 'fixture-refresh-token', expires_at: Math.floor(Date.now()/1000)+3600, expires_in:3600, token_type:'bearer', user:{id:'fixture-teacher',email:'teacher@example.invalid',aud:'authenticated'} };
  await page.addInitScript(({config,key,session})=>{
    localStorage.setItem('stacking-installation-config',JSON.stringify(config));
    localStorage.setItem(key,JSON.stringify(session));
  },{config,key,session});
  await page.route('**/api/installer/**',route=>route.fulfill({status:401,json:{code:'INSTALLER_AUTH_REQUIRED'}}));
  await page.route('**/functions/v1/student-api',route=>{
    const action=route.request().postDataJSON().action;
    const payloads: Record<string,unknown>={
      'teacher:classes':{classes:[{id:'existing-class',name:'기존 학급',class_code:'EXIST'}]},
      'teacher:students:list':{students:[{id:'existing-student',name:'기존 학생',student_no:1,status:'active',pinPlain:'1234',failedAttempts:0,lockedUntil:null,createdAt:'2026-01-01'}]},
      'teacher:lessons:list':{lessons:[]},
      'teacher:problems:list':{customProblems:[],builtinCount:0},
      'teacher:progress-summary':{students:[]},
    };
    return route.fulfill(action in payloads ? {json:payloads[action]} : {status:503,json:{error:{code:'UNAVAILABLE',message:'fixture'}}});
  });
  await page.goto('/teacher');
  await expect(page.getByRole('heading',{name:'교사 관리',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'기존 학생 · 기록 보기'})).toBeVisible();
  await expect(page.getByLabel('반 선택',{exact:true})).toContainText('기존 학급');
  const copy=page.getByRole('button',{name:'교사용 접속 링크 복사'});
  await expect(copy).toBeVisible();
  if(browserName==='chromium') {
    await context.grantPermissions(['clipboard-read','clipboard-write']);
    await copy.click();
    const link=await page.evaluate(()=>navigator.clipboard.readText());
    const value=JSON.parse(Buffer.from(new URL(link).hash.slice(9),'base64url').toString());
    expect(value).toEqual(config);
    expect(link).not.toContain('fixture-teacher-token');
    expect(Object.keys(value).sort()).toEqual(['installationId','supabasePublishableKey','supabaseUrl']);
  }
});
