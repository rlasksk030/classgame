import { test, expect, type Page } from '@playwright/test';
import { readMathInstallerPlan } from '../scripts/installer/math-plan';
import { emptyLegacyDb, legacyBackend } from '../tests/support/installer-legacy-db';
import { reconnectServer } from './support/reconnect-server';

async function consent(page: Page) {
  // External provider only. Catalog, aggregates, transition, status and cookies
  // run through the real installer HTTP server + real PostgreSQL engine.
  await page.route('https://api.supabase.com/v1/oauth/authorize**', route => {
    const url = new URL(route.request().url());
    return route.fulfill({status:302,headers:{location:`${url.searchParams.get('redirect_uri')}?code=synthetic&state=${url.searchParams.get('state')}`}});
  });
  await page.route('https://reconnect-project.supabase.co/**', route => route.fulfill({json:{}}));
}
for (const scenario of ['legacy','latest','drift'] as const) test(`real setup / PostgreSQL: ${scenario} with missing history`,async({page},info)=>{
  test.setTimeout(90000);
  const plan=await readMathInstallerPlan(process.cwd()); const db=await emptyLegacyDb();
  for(const m of plan.migrations.slice(0,scenario==='legacy'?17:24)) await db.exec(m.query.replace('create extension if not exists "pgcrypto";', ''));
  if(scenario==='drift') await db.exec('alter table sb_students alter column name drop not null');
  const backend=legacyBackend(db,plan,[]);let now=Date.now();
  const server=await reconnectServer(false,{plan,backend,now:()=>now});
  try {
    await consent(page);
    await page.goto(server.origin+'/setup');
    await page.getByRole('button',{name:'설치 시작하기',exact:true}).click();
    await page.getByRole('button',{name:'연결 화면으로',exact:true}).click();
    await page.getByRole('button',{name:'Supabase 연결',exact:true}).click();
    await expect(page.getByText('4/8',{exact:true})).toBeVisible();
    if(scenario==='drift') {
      await expect(page.getByText('기존 설치 구조 확인이 필요합니다.',{exact:true})).toBeVisible();
      await expect(page.getByLabel('설치 진단 정보')).toContainText('UNRECOGNIZED_SCHEMA');
      for(const name of ['수학 앱 설치','이어서 복구','업데이트','교사 확인으로 계속']) await expect(page.getByRole('button',{name,exact:true})).toBeDisabled();
      await page.getByRole('button',{name:'설치 확인',exact:true}).click(); await page.reload();
      await expect(page.getByRole('button',{name:'교사 확인으로 계속',exact:true})).toBeDisabled();
    } else {
      if(scenario==='legacy') {
        await expect(page.getByText('기존 설치를 확인했습니다. 기존 자료를 그대로 유지하고 최신 버전으로 준비합니다.',{exact:true})).toBeVisible();
        await page.reload();
        await expect(page.getByRole('button',{name:'기존 설치 계속하기',exact:true})).toBeEnabled();
        // Expired credential must reconnect once, preserve the DB, and return to
        // the recognized legacy state rather than a review/OAuth loop.
        now+=16*60*1000;
        await page.getByRole('button',{name:'설치 확인',exact:true}).click();
        await expect(page.getByRole('button',{name:'Supabase 다시 연결',exact:true})).toBeVisible();
        // The expired session was deleted. OAuth provider/grant clocks use real
        // time; restore the injected installer clock before a new authorization.
        now=Date.now();
        await page.getByRole('button',{name:'Supabase 다시 연결',exact:true}).click();
        await expect(page.getByRole('button',{name:'기존 설치 계속하기',exact:true})).toBeEnabled();
        await page.getByRole('button',{name:'기존 설치 계속하기',exact:true}).click();
      }
      await expect(page.getByRole('button',{name:'교사 확인으로 계속',exact:true})).toBeEnabled();
      await expect(page.getByText('데이터베이스 준비: 24/24',{exact:true})).toBeVisible();
      await page.screenshot({path:info.outputPath(`${scenario}-installed.png`),fullPage:true});
      await page.reload();
      await expect(page.getByRole('button',{name:'교사 확인으로 계속',exact:true})).toBeEnabled();
      await page.getByRole('button',{name:'교사 확인으로 계속',exact:true}).click();
      await expect(page.getByText('5/8',{exact:true})).toBeVisible();
    }
    await page.screenshot({path:info.outputPath(`${scenario}-final.png`),fullPage:true});
    expect(backend.calls.filter(c=>c.startsWith('applyMigration'))).toEqual([]);
    expect(backend.calls.filter(c=>c==='applyLegacyTransition')).toHaveLength(scenario==='legacy'?1:0);
    expect(backend.calls.filter(c=>c.startsWith('deployFunction')||c==='setSecrets')).toEqual([]);
    expect(server.events.filter(e=>e.path.endsWith('/authorize'))).toHaveLength(scenario==='legacy'?2:1);
  } finally {await server.close();await db.close();}
});
