import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { reconnectServer } from './support/reconnect-server';
import { createFakeInstallerBackend, createFakeManagementExtras } from '../scripts/installer/fake-backend';
import { InstallerError } from '../scripts/installer/contract';
import { catalogFingerprints, catalogAttributeFingerprints, type Catalog } from '../scripts/installer/database-state';

for (const drift of [false,true]) test(`real cookie/server key failure → retry → ${drift?'unsafe drift remains blocked':'step 5'}`,async({page},info)=>{
  const expected:Catalog=Object.fromEntries(['tables','columns','constraints','indexes','policies','rpcs','rpc_definitions','triggers','column_acls','policy_modes'].map(k=>[k,[]]));
  expected.tables=[{name:'sb_students',rls:true,force_rls:false,acl:['postgres=arwd/postgres']}];
  const actual=structuredClone(expected); if(drift) actual.tables[0].rls=false;
  const backend=createFakeInstallerBackend({secrets:['APP_SESSION_SECRET']});backend.inspectDatabaseCatalog=async()=>actual;
  const extras=createFakeManagementExtras({accessibleProjects:[{ref:'reconnect-project',name:'Synthetic selected project'}]});let attempts=0;
  extras.getPublishableKey=async()=>{if(++attempts===1)throw new InstallerError('INSTALLER_PUBLIC_KEY_FORBIDDEN','target','safe',403);return 'sb_publishable_synthetic_retry';};
  const query='select 1';
  const server=await reconnectServer(false,{backend,extras,plan:{productionRef:'blocked-production',appVersion:'test',schemaVersion:'test',functions:[],migrations:[{name:'synthetic',query}],databaseBaseline:{migrationHashes:[createHash('sha256').update(query).digest('hex')],profiles:[{name:'synthetic-release',kind:'RELEASE',prefix:1,objects:catalogFingerprints(expected),attributes:catalogAttributeFingerprints(expected)}]}}});
  try{
    await page.route('https://reconnect-project.supabase.co/**',route=>route.fulfill({json:{}}));
    await page.route('https://api.supabase.com/v1/oauth/authorize**',route=>{const u=new URL(route.request().url());return route.fulfill({status:302,headers:{location:`${u.searchParams.get('redirect_uri')}?code=synthetic&state=${u.searchParams.get('state')}`}});});
    await page.goto(server.origin+'/setup');
    await page.getByRole('button',{name:'설치 시작하기',exact:true}).click();
    await page.getByRole('button',{name:'연결 화면으로',exact:true}).click();
    await page.getByRole('button',{name:'Supabase 연결',exact:true}).click();
    await expect(page.getByRole('alert').last()).toContainText('API 키 조회 권한');
    await expect(page.getByText('3/8',{exact:true})).toBeVisible();
    await expect(page.getByRole('combobox',{name:/프로젝트/})).toHaveValue('reconnect-project');
    expect(attempts).toBe(1);
    // One scenario retries in place; the other also proves browser reload with
    // an already-consumed OAuth grant recovers the bound project automatically.
    if(drift) await page.reload(); else await page.getByRole('button',{name:'이 프로젝트 사용',exact:true}).click();
    await expect(page.getByText('4/8',{exact:true})).toBeVisible();
    expect(attempts).toBe(2);
    expect(server.events.filter(e=>e.path.endsWith('/authorize'))).toHaveLength(1);
    if(drift){
      await page.getByText('진단 상세',{exact:true}).click();
      await expect(page.getByLabel('차이 객체 목록')).toContainText('rls: 다름');
      for(const name of ['수학 앱 설치','이어서 복구','업데이트','교사 확인으로 계속'])await expect(page.getByRole('button',{name,exact:true})).toBeDisabled();
    }else{
      await page.getByRole('button',{name:'교사 확인으로 계속',exact:true}).click();
      await expect(page.getByText('5/8',{exact:true})).toBeVisible();
    }
    expect(backend.calls.some(c=>/^(apply|deploy|setSecrets)/.test(c))).toBe(false);
    await page.screenshot({path:info.outputPath('public-key-recovered.png'),fullPage:true});
  }finally{await server.close();}
});
