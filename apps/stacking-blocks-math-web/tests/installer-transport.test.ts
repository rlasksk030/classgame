import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseManagementBackend } from '../scripts/installer/management-api.ts';
import { EphemeralCredential } from '../scripts/installer/security.ts';

const target = { environment:'TEST' as const, projectRef:'synthetic-project', projectUrl:'https://synthetic-project.supabase.co', release:'test' };
const key = 'sb_publishable_synthetic';
const make = (fetchImpl: typeof fetch, options = {}) => new SupabaseManagementBackend({ accessToken:new EphemeralCredential('synthetic-private-token'), fetchImpl, waitForRetry:async()=>{}, requestTimeoutMs:20, mutationTimeoutMs:20, ...options });

test('public key lookup retries lost/429/503 responses within three attempts', async()=>{
  for (const first of ['network',429,503] as const) {
    let calls=0; const delays:number[]=[];
    const backend=make(async()=>{calls++;if(calls===1){if(first==='network')throw Error('private upstream');return new Response('',{status:first,headers:{'retry-after':'2'}});}return Response.json([{type:'publishable',name:'default',api_key:key}]);},{waitForRetry:async(ms:number)=>{delays.push(ms);}});
    assert.equal(await backend.getPublishableKey(target),key); assert.equal(calls,2);
    assert.deepEqual(delays,[first==='network'?250:2000]);
  }
});

test('public key lookup caps retry count and never retries authentication failures',async()=>{
  for(const [status,expected] of [[401,1],[403,1],[404,1],[429,3],[500,3]] as const){
    let calls=0;const backend=make(async()=>{calls++;return Response.json({code:'private-secret-code'},{status});});
    await assert.rejects(backend.getPublishableKey(target));assert.equal(calls,expected);
  }
});

test('large Retry-After stops automatic retry instead of hammering before its deadline',async()=>{
  let calls=0;const backend=make(async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'3600'}});});
  await assert.rejects(backend.getPublishableKey(target),{code:'INSTALLER_PUBLIC_KEY_RATE_LIMITED'});assert.equal(calls,1);
});

test('response body stalls are bounded, aborted and retryable only for reads',async()=>{
  let calls=0;const signals:AbortSignal[]=[];
  const backend=make(async(_url,init)=>{
    calls++; assert.ok(init?.signal); signals.push(init.signal);
    return new Response(new ReadableStream({start(controller){init.signal!.addEventListener('abort',()=>controller.error(Error('private body')),{once:true});}}));
  });
  await assert.rejects(backend.request('target','/v1/projects'),{code:'INSTALLER_MANAGEMENT_TIMEOUT'});
  assert.equal(calls,3);assert.ok(signals.every(signal=>signal.aborted));
});

test('migration/secret/function writes are never replayed after ambiguous network failure',async()=>{
  for(const status of [429,500,'network','timeout'] as const){
    let calls=0;const backend=make(async(_url,init)=>{calls++;assert.equal(init?.redirect,'error');if(status==='network')throw Error('private');if(status==='timeout')return new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(Error('private')),{once:true}));return new Response('',{status});});
    await assert.rejects(backend.applyMigration(target,{name:'test.sql',query:'select 1'}));assert.equal(calls,1);
  }
});

test('disposed credential stops retries and arbitrary upstream error codes never escape',async()=>{
  const credential=new EphemeralCredential('synthetic-private-token');let calls=0;
  const backend=new SupabaseManagementBackend({accessToken:credential,fetchImpl:async()=>{calls++;return new Response('',{status:500});},waitForRetry:async()=>{credential.dispose();}});
  await assert.rejects(backend.request('target','/v1/projects'),{code:'INSTALLER_CREDENTIAL_DISPOSED'});assert.equal(calls,1);
  const unsafe=make(async()=>Response.json({code:'private-secret-code',message:'private-message'},{status:403}));
  await assert.rejects(unsafe.request('target','/v1/projects'),{code:'INSTALLER_MANAGEMENT_HTTP_403',upstreamStatus:403});
});

test('public Auth and function probes block redirects and bound body/network stalls',async()=>{
  for(const kind of ['auth','function']){
    const backend=make(async(_url,init)=>{assert.equal(init?.redirect,'error');assert.ok(init?.signal);return new Promise((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(Error('private')),{once:true}));});
    if(kind==='auth')await assert.rejects(backend.verifyPublishableKey(target,key),{code:'INSTALLER_PUBLIC_KEY_PROBE_UNREACHABLE'});
    else await assert.rejects(backend.probeFunction({...target,publishableKey:key},'student-api'),{code:'INSTALLER_FUNCTION_PROBE_UNREACHABLE'});
  }
});

test('teacher provisioning key excludes disabled, revoked, mislabeled and cross-project credentials',async()=>{
  const legacy=(ref=target.projectRef,role='service_role')=>`e30.${Buffer.from(JSON.stringify({ref,role})).toString('base64url')}.synthetic`;
  for(const row of [
    {type:'secret',name:'default',api_key:'sb_secret_disabled',disabled:true},
    {type:'secret',name:'default',api_key:'sb_secret_revoked',revoked_at:'2026-01-01'},
    {type:'secret',name:'default',api_key:key},
    {type:'legacy',name:'service_role',api_key:legacy('other-project')},
    {type:'legacy',name:'service_role',api_key:legacy(target.projectRef,'anon')},
  ]) assert.equal(await make(async()=>Response.json([row])).getServiceRoleCredential(target),undefined);
  const credential=await make(async()=>Response.json([{type:null,name:'service_role',api_key:legacy()}])).getServiceRoleCredential(target);
  assert.ok(credential);assert.equal(await credential.use(async value=>value),legacy());credential.dispose();
});
