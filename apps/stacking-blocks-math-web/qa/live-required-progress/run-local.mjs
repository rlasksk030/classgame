/* global process, console */
// Only schema metadata and synthetic data. No remote Supabase client is used.
import { readFileSync, writeFileSync, cpSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const [catalogPath, oldApiPath, outputPath] = process.argv.slice(2);
if (!catalogPath || !oldApiPath || !outputPath) throw new Error('Usage: node run-local.mjs PRIVATE_CATALOG.json PRIVATE_NORMALIZED_OLD_API_DIR PRIVATE_OUTPUT_DIR');
const qa=dirname(fileURLToPath(import.meta.url)),app=resolve(qa,'../..'),output=resolve(outputPath);
mkdirSync(output,{recursive:true});const dir=mkdtempSync(join(output,'synthetic-'));
for(const name of ['supabase/functions','shared','oracle']) cpSync(join(app,name),join(dir,name),{recursive:true});
for(const name of ['fixture.mjs','adapter.mjs','smoke.mjs','catalog-local-select.sql','backfill-aggregate.sql','check-package.mjs']) cpSync(join(qa,name),join(dir,name));
mkdirSync(join(dir,'evidence'));cpSync(resolve(catalogPath),join(dir,'evidence/current-catalog.json'));
cpSync(resolve(oldApiPath),join(dir,'rollback-smoke'),{recursive:true});
const stub=readFileSync(join(qa,'test-only-db-stub.txt'));
writeFileSync(join(dir,'supabase/functions/_shared/db.ts'),stub);writeFileSync(join(dir,'rollback-smoke/_shared/db.ts'),stub);
mkdirSync(join(dir,'supabase/migrations'),{recursive:true});const delta='20261003051402_actual_use_required_progress_delta.sql';
cpSync(join(qa,'sql',delta),join(dir,'supabase/migrations',delta));
symlinkSync(join(app,'node_modules'),join(dir,'node_modules'));writeFileSync(join(dir,'package.json'),'{"type":"module","private":true}\n');
function run(file,args=[],env={}) {const r=spawnSync(process.execPath,['--experimental-strip-types',file,...args],{cwd:dir,stdio:'inherit',env:{...process.env,...env}});if(r.status!==0)throw new Error(file+' failed');}
run('smoke.mjs');
// Use schema recreated by the fixture, not historical migrations.
writeFileSync(join(dir,'expected.mjs'),`import {createFixture,snapshot} from './fixture.mjs';import {readFileSync,writeFileSync} from 'node:fs';const db=await createFixture();try{await db.exec(readFileSync('supabase/migrations/${delta}','utf8'));writeFileSync('evidence/expected.json',JSON.stringify(await snapshot(db)));}finally{await db.close();}`);
run('expected.mjs');const dbOutput=join(dir,'package-db');mkdirSync(dbOutput);cpSync(join(qa,'sql',delta),join(dbOutput,'APPLY.sql'));
run(join(qa,'build-checks.mjs'),[join(dir,'evidence/current-catalog.json'),join(dir,'evidence/expected.json'),dbOutput]);
run('check-package.mjs',[],{FINAL_PACKAGE_DB:dbOutput});
console.log('LOCAL ONLY verification artifacts:',dir);
