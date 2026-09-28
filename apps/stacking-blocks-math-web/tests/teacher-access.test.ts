import test from 'node:test';
import assert from 'node:assert/strict';
import { safeTeacherReturnPath, rememberTeacherReturn, clearTeacherReturn, teacherInstallationLink } from '../src/lib/teacherAccess.ts';
import { encodeInstallationConfig, readInstallationConfigFromHash, validateRuntimeSupabaseConfig } from '../src/lib/config.ts';
const config = { installationId: 'public-project', supabaseUrl: 'https://public-project.supabase.co', supabasePublishableKey: 'sb_publishable_fixture' };
const jwt = (payload: object) => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;

test('return path accepts only the exact teacher route', () => {
  assert.equal(safeTeacherReturnPath('/teacher'), '/teacher');
  for (const path of ['https://evil.invalid', '//evil.invalid', '/\\evil.invalid', '/teacher?next=evil', '/teacher#secret', '/setup', '%2Fteacher', '/teacher/../setup', '/teacher\n', null, undefined]) assert.equal(safeTeacherReturnPath(path), null);
});
test('return survives OAuth reload and is consumed without storing credentials', () => {
  const values = new Map<string,string>();
  Object.assign(globalThis, { sessionStorage: { getItem: (key:string) => values.get(key), setItem: (key:string,value:string) => values.set(key,value), removeItem: (key:string) => values.delete(key) } });
  assert.equal(rememberTeacherReturn('?returnTo=%2Fteacher'), '/teacher');
  assert.equal(rememberTeacherReturn('?oauth=granted'), '/teacher');
  assert.deepEqual([...values.values()], ['/teacher']);
  clearTeacherReturn();
  assert.equal(rememberTeacherReturn('?oauth=granted'), null);
  assert.equal(rememberTeacherReturn('?returnTo=https://evil.invalid'), null);
  delete (globalThis as {sessionStorage?:unknown}).sessionStorage;
});
test('teacher share link reuses install fragment and excludes extra secret fields', () => {
  const link = teacherInstallationLink({ ...config, service_role: 'private', oauthSecret: 'private', teacherPassword: 'private', access_token: 'private', studentPin: '1234' } as typeof config, 'https://app.example');
  const url = new URL(link);
  assert.equal(url.pathname, '/teacher');
  assert.equal(url.search, '');
  assert.deepEqual(readInstallationConfigFromHash(url.hash), config);
  assert.deepEqual(Object.keys(JSON.parse(Buffer.from(url.hash.slice(9),'base64url').toString())).sort(), ['installationId','supabasePublishableKey','supabaseUrl']);
});
test('privileged and user-session JWTs are rejected even without plaintext secret labels', () => {
  for (const payload of [{role:'service_role'}, {role:'authenticated',sub:'user'}, {role:'anon',session_id:'session'}, {role:'anon',sub:'user'}]) {
    const bad = {...config,supabasePublishableKey:jwt(payload)};
    assert.equal(validateRuntimeSupabaseConfig(bad), false);
    assert.throws(() => encodeInstallationConfig(bad));
  }
  assert.equal(validateRuntimeSupabaseConfig({...config,supabasePublishableKey:jwt({role:'anon',ref:'public-project'})}),true);
});
test('malformed links and secret-bearing URLs fail safely', () => {
  for (const hash of ['#install=', '#install=not-base64', '#install=e30', '#install=abc&token=private']) assert.equal(readInstallationConfigFromHash(hash),null);
  for (const supabaseUrl of ['https://user:password@example.com', 'https://example.com/?token=private', 'https://example.com/#private', 'javascript:alert(1)']) assert.equal(validateRuntimeSupabaseConfig({...config,supabaseUrl}),false);
});

test('teacher links include a derived public project ref, never an arbitrary ID or opaque token', () => {
  const link = teacherInstallationLink({...config,installationId:'private-identifier'},'https://app.example');
  assert.equal(readInstallationConfigFromHash(new URL(link).hash)?.installationId,'public-project');
  assert.equal(teacherInstallationLink({...config,supabasePublishableKey:'opaque-access-token'},'https://app.example'),'');
});
