import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { emptyLegacyDb } from './support/installer-legacy-db.ts';
import { readMathInstallerPlan } from '../scripts/installer/math-plan.ts';
import { catalogDigestQuery } from '../scripts/installer/legacy-sql.ts';

// Match PostgreSQL jsonb::text spacing without changing object-key order.
function jsonbText(value: unknown): string {
  if (Array.isArray(value)) return '['+value.map(jsonbText).join(', ')+']';
  if (value && typeof value==='object') return '{'+Object.entries(value).map(([k,v])=>JSON.stringify(k)+': '+jsonbText(v)).join(', ')+'}';
  return JSON.stringify(value);
}
const md5=(value:string)=>createHash('md5').update(value).digest('hex');
test('transaction digest pins C ordering; en_US ordering exactly reproduces native PostgreSQL CI failure',async()=>{
  const db=await emptyLegacyDb(),plan=await readMathInstallerPlan(process.cwd());
  try {
    await db.exec(plan.migrations[0].query.replace('create extension if not exists "pgcrypto";',''));
    const query=catalogDigestQuery(readFileSync('scripts/installer/catalog.sql','utf8'));
    assert.equal((query.match(/collate "C"/g)??[]).length,2,'pin both object and ACL/search_path array ordering');
    const expected=plan.legacyRecovery!.transitions.find(t=>t.from==='history-prefix-1')!.query.match(/actual is distinct from '([a-f0-9]{32})'/)![1];
    assert.equal((await db.query<{digest:string}>(query)).rows[0].digest,expected);
    const rawQuery=query.replace('md5(jsonb_object_agg(k, v)::text) as digest','jsonb_object_agg(k, v)::text as canonical');
    const canonical=(await db.query<{canonical:string}>(rawQuery)).rows[0].canonical;
    const parsed=JSON.parse(canonical) as Record<string,unknown[]>;
    assert.equal(jsonbText(parsed),canonical,'comparison changes ordering only');
    const compare=new Intl.Collator('en-US',{ignorePunctuation:true}).compare;
    for(const rows of Object.values(parsed)) rows.sort((a,b)=>compare(jsonbText(a),jsonbText(b)));
    assert.equal(md5(jsonbText(parsed)),'c1a8a680cf561d375115d68e3e2825c8','exact previously observed native PostgreSQL failure');
    assert.notEqual(md5(jsonbText(parsed)),expected,'database locale used to cause false drift despite identical schema');
    for(const transition of plan.legacyRecovery!.transitions) {
      assert.equal((transition.query.match(/order by normalized\.row::text collate "C"/g)??[]).length,2);
      assert.equal((transition.query.match(/order by a\.value::text collate "C"/g)??[]).length,2);
    }
  }finally{await db.close();}
});
