import {test as base,expect,type Page} from '@playwright/test';
export {expect};
export const API_ORIGIN='https://math-e2e.invalid';
export async function configureLivePage(page:Page){
 await page.addInitScript(()=>localStorage.setItem('stacking-installation-config',JSON.stringify({installationId:'live-e2e',supabaseUrl:'https://math-e2e.invalid',supabasePublishableKey:'synthetic-public-key'})));
 // No production traffic: later page.route handlers supply only explicit synthetic endpoints.
 await page.context().route('**/*',route=>{
  const host=new URL(route.request().url()).hostname;
  return host==='127.0.0.1'||host==='localhost'?route.continue():route.abort('blockedbyclient');
 });
}
export const test=base.extend({page:async({page},use)=>{await configureLivePage(page);await use(page);}});
