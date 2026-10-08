import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseManagementBackend } from '../scripts/installer/management-api.ts';
import { EphemeralCredential } from '../scripts/installer/security.ts';
import { InstallerError } from '../scripts/installer/contract.ts';
import { createInstallerServer } from '../scripts/installer/http-server.ts';
import { createFakeInstallerBackend, createFakeManagementExtras } from '../scripts/installer/fake-backend.ts';
const target = { environment:'TEST' as const,projectRef:'synthetic-project',projectUrl:'https://synthetic-project.supabase.co',release:'test' };
const publicKey='sb_publishable_synthetic';
const jwt = (role='anon',ref=target.projectRef) => `e30.${Buffer.from(JSON.stringify({role,ref})).toString('base64url')}.synthetic`;
const modern={type:'publishable',name:'任意 default',api_key:publicKey};
const legacy={type:'legacy',name:'anon',api_key:jwt()};
const secret={type:'secret',name:'default',api_key:'sb_secret_synthetic_never_output'};
for (const [name,keys,expected] of [
  ['modern',[modern],publicKey],['legacy',[legacy],jwt()],['prefer modern',[legacy,modern],publicKey],
  ['null type',[{...legacy,type:null}],jwt()],['missing type',[{name:'anon',api_key:jwt()}],jwt()],
  ['disabled',[{...modern,disabled:true},legacy],jwt()],['inactive',[{...modern,status:'disabled'},legacy],jwt()],
  ['empty',[{...modern,api_key:''},legacy],jwt()],['null value',[{...modern,api_key:null},legacy],jwt()],
  ['missing value',[{type:'publishable',name:'default'},legacy],jwt()],
  ['secrets only',[secret,{type:'legacy',name:'service_role',api_key:jwt('service_role')}],undefined],
  ['mislabeled secret',[{...modern,api_key:secret.api_key},{...legacy,api_key:jwt('service_role')}],undefined],
  ['wrong project',[{...legacy,api_key:jwt('anon','different-project')}],undefined],
  ['unknown type',[{...modern,type:'unknown'}],undefined],['untyped arbitrary name',[{name:'default',api_key:publicKey}],undefined],
] as const) test(`public key selection: ${name}`,async()=>{
  const logs:string[]=[];const old=console.error;console.error=v=>logs.push(String(v));
  try {
    const backend=new SupabaseManagementBackend({accessToken:new EphemeralCredential('synthetic-credential'),fetchImpl:async(input)=>{assert.ok(String(input).endsWith('/api-keys?reveal=true'));return Response.json(keys);}});
    assert.equal(await backend.getPublishableKey(target),expected);
    const metadata=JSON.parse(logs[0]); assert.equal(metadata.metadataCount,keys.length);assert.equal(metadata.selectable,expected!==undefined);
    for(const value of [publicKey,jwt(),secret.api_key,'synthetic-credential']) assert.equal(logs.join('').includes(value),false);
  }finally{console.error=old;}
});
for(const [status,code] of [[401,'UNAUTHORIZED'],[403,'FORBIDDEN'],[404,'NOT_FOUND'],[429,'RATE_LIMITED'],[500,'UPSTREAM_FAILED']] as const) test(`key lookup ${status} has safe distinct diagnosis`,async()=>{
  const backend=new SupabaseManagementBackend({accessToken:new EphemeralCredential('synthetic'),fetchImpl:async()=>Response.json({code:'sb_secret_unsafe_upstream',message:'synthetic-sensitive'},{status})});
  await assert.rejects(backend.getPublishableKey(target),(error:unknown)=>error instanceof InstallerError && error.code===`INSTALLER_PUBLIC_KEY_${code}` && error.upstreamStatus===status && !error.message.includes('synthetic-sensitive'));
});
for(const response of [{keys:[modern]},null,'malformed']) test(`unrecognized API response fails closed: ${JSON.stringify(response).slice(0,15)}`,async()=>{
  const backend=new SupabaseManagementBackend({accessToken:new EphemeralCredential('synthetic'),fetchImpl:async()=>Response.json(response)});
  await assert.rejects(backend.getPublishableKey(target),{code:'INSTALLER_KEY_RESPONSE_INVALID'});
});
test('network error never echoes upstream message',async()=>{
  const backend=new SupabaseManagementBackend({accessToken:new EphemeralCredential('synthetic'),fetchImpl:async()=>{throw Error(secret.api_key);}});
  await assert.rejects(backend.getPublishableKey(target),{code:'INSTALLER_PUBLIC_KEY_NETWORK'});
});
test('public probe rejects private keys, wrong-ref JWTs, redirects, non-JSON and failed Auth settings',async()=>{
  for(const value of [secret.api_key,jwt('service_role'),jwt('anon','another-project')]) {
    const backend=new SupabaseManagementBackend({accessToken:new EphemeralCredential('synthetic'),fetchImpl:async()=>{throw Error('must never send secret');}});
    await assert.rejects(backend.verifyPublishableKey(target,value),{code:'INSTALLER_PUBLIC_KEY_INVALID'});
  }
  for(const status of [200,401,403,302]){
    const backend=new SupabaseManagementBackend({accessToken:new EphemeralCredential('synthetic'),fetchImpl:async(input,init)=>{
      assert.equal(String(input),target.projectUrl+'/auth/v1/settings');assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');
      assert.equal(new Headers(init?.headers).has('authorization'),false);
      return Response.json({external:{}},{status});
    }});
    if(status===200) await backend.verifyPublishableKey(target,publicKey);
    else await assert.rejects(backend.verifyPublishableKey(target,publicKey),{code:'INSTALLER_PUBLIC_KEY_PROBE_FAILED'});
  }
  const invalid=new SupabaseManagementBackend({accessToken:new EphemeralCredential('synthetic'),fetchImpl:async()=>new Response('<html>proxy</html>')});
  await assert.rejects(invalid.verifyPublishableKey(target,publicKey),{code:'INSTALLER_PUBLIC_KEY_PROBE_INVALID'});
});

test('consumed OAuth grant: same-session key retry succeeds, project cannot change, revoke blocks reuse',async()=>{
  const backend=createFakeInstallerBackend();
  const extras=createFakeManagementExtras({accessibleProjects:[{ref:target.projectRef}]});let attempts=0;
  extras.getPublishableKey=async()=>{attempts++;if(attempts===1)throw new InstallerError('INSTALLER_PUBLIC_KEY_FORBIDDEN','target','safe',403);return publicKey;};
  const server=createInstallerServer({mode:'PRODUCTION',productionRef:'blocked-project',allowedProjectRefs:['different-allowlist'],allowedOrigins:['https://frontend.example'],createBackend:()=>backend,createManagementExtras:()=>extras,plan:{productionRef:'blocked-project',migrations:[],functions:[],appVersion:'test',schemaVersion:'test'},oauth:{clientId:'synthetic',clientSecret:new EphemeralCredential('synthetic'),redirectUri:'https://frontend.example/api/installer/oauth/callback',fetchImpl:async()=>Response.json({access_token:'synthetic-grant'})}});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const addr=server.address();assert.ok(addr&&typeof addr!=='string');const base=`http://127.0.0.1:${addr.port}`;
  const post=(path:string,cookie:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{cookie,origin:'https://frontend.example','content-type':'application/json'},body:JSON.stringify(body)});
  try {
    const auth=await(await post('/api/installer/authorize','',{})).json();const state=new URL(auth.authorizeUrl).searchParams.get('state');
    const callback=await fetch(base+'/api/installer/oauth/callback?code=synthetic&state='+state,{redirect:'manual'});
    const grant=callback.headers.getSetCookie()[0].split(';')[0];
    const first=await post('/api/installer/session',grant,target);const body=await first.json();assert.equal(body.status,'AUTHORIZED');assert.equal(body.publicKeyError.code,'INSTALLER_PUBLIC_KEY_FORBIDDEN');assert.equal(body.publishableKey,undefined);
    const cookie=first.headers.getSetCookie().find(c=>c.startsWith('installer_session='))!.split(';')[0];
    const retry=await post('/api/installer/session',cookie,target);const recovered=await retry.json();assert.equal(recovered.publishableKey,publicKey);assert.equal(attempts,2);
    const changed=await post('/api/installer/session',cookie,{...target,projectRef:'other-project',projectUrl:'https://other-project.supabase.co'});assert.equal((await changed.json()).code,'INSTALLER_PROJECT_NOT_ALLOWED');assert.equal(attempts,2);
    const restored=await fetch(base+'/api/installer/projects',{headers:{cookie}});assert.equal((await restored.json()).projects[0].ref,target.projectRef);
    const mismatch=await fetch(base+'/api/installer/projects?projectRef=other-project&projectUrl=https://other-project.supabase.co',{headers:{cookie}});assert.equal((await mismatch.json()).code,'INSTALLER_TARGET_MISMATCH');
    await fetch(base+'/api/installer/session',{method:'DELETE',headers:{cookie}});
    const revoked=await post('/api/installer/session',cookie,target);assert.notEqual((await revoked.json()).status,'AUTHORIZED');assert.equal(attempts,2);
    assert.equal(backend.calls.some(c=>/^(apply|deploy|setSecrets)/.test(c)),false);
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});

test('two authenticated sessions keep cached keys isolated; cached recovery needs a successful same-project Auth probe',async()=>{
  const backend=createFakeInstallerBackend();
  const projects=['synthetic-alpha','synthetic-beta'];const keys=Object.fromEntries(projects.map(p=>[p,`sb_publishable_${p.replace('-','_')}`]));
  const extras=createFakeManagementExtras({accessibleProjects:projects.map(ref=>({ref}))});
  extras.getPublishableKey=async()=>{throw new InstallerError('INSTALLER_PUBLIC_KEY_FORBIDDEN','target','safe',403);};
  extras.verifyPublishableKey=async(t,key)=>{if(keys[t.projectRef]!==key)throw new InstallerError('INSTALLER_PUBLIC_KEY_PROBE_FAILED','target','safe',401);};
  const server=createInstallerServer({productionRef:'blocked-project',allowedOrigins:['https://frontend.example'],createBackend:()=>backend,createManagementExtras:()=>extras,plan:{productionRef:'blocked-project',migrations:[],functions:[],appVersion:'test',schemaVersion:'test'},oauth:{clientId:'synthetic',clientSecret:new EphemeralCredential('synthetic'),redirectUri:'https://frontend.example/api/installer/oauth/callback',fetchImpl:async()=>Response.json({access_token:'synthetic-grant'})}});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const addr=server.address();assert.ok(addr&&typeof addr!=='string');const base=`http://127.0.0.1:${addr.port}`;
  const post=(path:string,cookie:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{cookie,origin:'https://frontend.example','content-type':'application/json'},body:JSON.stringify(body)});
  try{
    const sessions=await Promise.all(projects.map(async ref=>{
      const auth=await(await post('/api/installer/authorize','',{})).json();const state=new URL(auth.authorizeUrl).searchParams.get('state');
      const callback=await fetch(base+'/api/installer/oauth/callback?code=synthetic&state='+state,{redirect:'manual'});
      const t={...target,projectRef:ref,projectUrl:`https://${ref}.supabase.co`,publishableKey:keys[ref]};
      const res=await post('/api/installer/session',callback.headers.getSetCookie()[0].split(';')[0],t);assert.equal((await res.json()).publishableKey,keys[ref]);
      return {t,cookie:res.headers.getSetCookie().find(c=>c.startsWith('installer_session='))!.split(';')[0]};
    }));
    for(const [i,{t,cookie}] of sessions.entries()){
      const retry=await post('/api/installer/session',cookie,{...t,publishableKey:undefined});assert.equal((await retry.json()).publishableKey,keys[t.projectRef]);
      const other=sessions[1-i].t;
      const cross=await fetch(base+'/api/installer/status?'+new URLSearchParams({projectRef:other.projectRef,projectUrl:other.projectUrl}),{headers:{cookie}});
      assert.equal((await cross.json()).code,'INSTALLER_TARGET_MISMATCH');
    }
    // Cached success isn't sticky when the same project's gateway rejects it.
    extras.verifyPublishableKey=async()=>{throw new InstallerError('INSTALLER_PUBLIC_KEY_PROBE_FAILED','target','safe',401);};
    const invalid=await post('/api/installer/session',sessions[0].cookie,sessions[0].t);const result=await invalid.json();assert.equal(result.publishableKey,undefined);assert.equal(result.publicKeyError.code,'INSTALLER_PUBLIC_KEY_PROBE_FAILED');
    assert.equal(backend.calls.some(c=>/^(apply|deploy|setSecrets)/.test(c)),false);
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
