import { test, expect } from '@playwright/test';
import { reconnectServer } from './support/reconnect-server';
import { createFakeInstallerBackend } from '../scripts/installer/fake-backend';
import { InstallerError } from '../scripts/installer/contract';

const config = { installationId: 'existing-empty-projects', supabaseUrl: 'https://reconnect-project.supabase.co', supabasePublishableKey: 'sb_publishable_synthetic_old' };
for (const scenario of ['existing', '403', '404', 'fresh'] as const) test(`real installer empty project list: ${scenario}`, async ({page}) => {
  const backend = createFakeInstallerBackend({ secrets:['APP_SESSION_SECRET'] });
  let directInspections = 0;
  backend.inspectProject = async target => {
    directInspections++;
    if (scenario === '403' || scenario === '404') throw new InstallerError('SYNTHETIC_FORBIDDEN', 'target', 'synthetic', Number(scenario));
    return { ref: target.projectRef };
  };
  const server = await reconnectServer(false, { backend, emptyProjects:true, plan:{ productionRef:'blocked-production',migrations:[],functions:[],appVersion:'test',schemaVersion:'test' } });
  try {
    await page.addInitScript(({config,scenario}) => {
      if (scenario !== 'fresh') localStorage.setItem('stacking-installation-config', JSON.stringify(config));
    }, {config,scenario});
    await page.route('https://reconnect-project.supabase.co/**', route => route.fulfill({json:{}}));
    await page.route('https://api.supabase.com/v1/oauth/authorize**', route => {
      const url = new URL(route.request().url());
      return route.fulfill({status:302,headers:{location:`${url.searchParams.get('redirect_uri')}?code=synthetic&state=${url.searchParams.get('state')}`}});
    });
    await page.goto(server.origin + '/setup');
    await page.getByRole('button',{name:'설치 시작하기',exact:true}).click();
    await page.getByRole('button',{name:'연결 화면으로',exact:true}).click();
    await page.getByRole('button',{name:/^Supabase (다시 )?연결$/}).click();
    if (scenario === 'existing') {
      await expect(page.getByText('4/8',{exact:true})).toBeVisible();
      await expect(page.getByRole('button',{name:'교사 확인으로 계속',exact:true})).toBeEnabled();
      expect(directInspections).toBeGreaterThanOrEqual(2);
      const before = server.events.filter(e=>e.path.endsWith('/projects')).length;
      await page.reload();
      await expect(page.getByText('4/8',{exact:true})).toBeVisible();
      expect(server.events.filter(e=>e.path.endsWith('/projects')).length).toBe(before);
      expect(server.events.filter(e=>e.path.endsWith('/authorize'))).toHaveLength(1);
      await page.getByRole('button',{name:'교사 확인으로 계속',exact:true}).click();
      await expect(page.getByText('5/8',{exact:true})).toBeVisible();
    } else if (scenario === 'fresh') {
      await expect(page.getByText('선택할 수 있는 프로젝트가 없어요. Supabase에서 먼저 프로젝트를 만든 뒤 다시 연결해 주세요.',{exact:true})).toBeVisible();
      expect(directInspections).toBe(0);
    } else {
      await expect(page.getByRole('alert').last()).toContainText(scenario === '403' ? '처음 설치할 때 사용한 Supabase 계정' : '기존 설치 정보에 해당하는 프로젝트');
      await expect(page.getByText(/Supabase에서 먼저 프로젝트를 만든/)).toHaveCount(0);
      expect(server.events.some(e=>e.path.endsWith('/session') && e.method==='POST')).toBe(false);
    }
    expect(backend.calls.some(c=>/^(apply|deploy|setSecrets)/.test(c))).toBe(false);
  } finally { await server.close(); }
});

test('drift details show all safe keys and changes; every mutation and step 5 stay blocked', async ({page}) => {
  await page.addInitScript(config => {
    localStorage.setItem('stacking-installation-config',JSON.stringify(config));
    localStorage.setItem('stacking-installer-progress',JSON.stringify({installationId:config.installationId,step:4,updatedAt:new Date().toISOString()}));
  },config);
  await page.route('**/api/installer/status**',route=>route.fulfill({json:{status:'DRIFT_REQUIRES_REVIEW',project:{ref:'reconnect-project'},databaseReview:{reason:'UNRECOGNIZED_SCHEMA',baseline:'history-prefix-24',comparisonBaseline:'history-prefix-24',objects:Array.from({length:22},(_,i)=>({key:`columns:sb_students:column_${i}:`,change:'CHANGED'}))}}}));
  await page.goto('/setup');
  // Persisted step storage differs by installation; reach the connection step
  // explicitly if this fixture starts at the welcome screen.
  if (await page.getByRole('button',{name:'설치 시작하기',exact:true}).isVisible()) {
    await page.getByRole('button',{name:'설치 시작하기',exact:true}).click();
    await page.getByRole('button',{name:'연결 화면으로',exact:true}).click();
  }
  await expect(page.getByText('4/8',{exact:true})).toBeVisible();
  await page.getByText('진단 상세',{exact:true}).click();
  await expect(page.getByLabel('차이 객체 목록').getByRole('listitem')).toHaveCount(22);
  await expect(page.getByLabel('차이 객체 목록')).toContainText('columns:sb_students:column_21:');
  for(const name of ['수학 앱 설치','이어서 복구','업데이트','교사 확인으로 계속']) await expect(page.getByRole('button',{name,exact:true})).toBeDisabled();
});
