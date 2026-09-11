import { generatePin, hashPin, issueSessionToken, verifySessionToken } from '../functions/_shared/security.ts';
Deno.test('PIN hashes are scoped by student; session tampering fails', async () => {
  Deno.env.set('APP_SESSION_SECRET','local-test-secret-not-for-production');
  const check=(value:unknown)=>{if(!value)throw new Error('security assertion failed');};
  check(await hashPin('student-a','7391') !== await hashPin('student-b','7391'));
  check(await hashPin('student-a','7391') !== await hashPin('student-a','7392'));
  for(let i=0;i<100;i++) check(/^\d{4}$/.test(generatePin()));
  const issued=await issueSessionToken('student-a','class-a');
  check((await verifySessionToken(issued.token))?.sid==='student-a');
  const [payload,signature]=issued.token.split('.');
  const changed=btoa(JSON.stringify({...issued.payload,sid:'student-b'})).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  check(await verifySessionToken(changed+'.'+signature)===null);
  check(await verifySessionToken(payload+'.'+'0'.repeat(signature.length))===null);
  check(await verifySessionToken('invalid')===null);
  Deno.env.delete('APP_SESSION_SECRET');
});
