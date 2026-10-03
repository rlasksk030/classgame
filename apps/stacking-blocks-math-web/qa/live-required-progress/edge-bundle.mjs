/* global process, console */
import { collectFunctionBundleFiles, hashFunctionBundle } from '../../scripts/installer/function-bundle.ts';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const app=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),out=process.argv[2];
if(!out)throw new Error('Usage: node --experimental-strip-types edge-bundle.mjs PRIVATE_OUTPUT_DIR');
const files=await collectFunctionBundleFiles(app,join(app,'supabase/functions/student-api/index.ts'));
for(const f of files){const dest=join(out,'target',f.path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,f.content);}
const sha=s=>createHash('sha256').update(s).digest('hex');
const manifest={source_head:'5a90a242925e2d62af0376f6e99d9416c21248e4',slug:'student-api',entrypoint:'supabase/functions/student-api/index.ts',verify_jwt:false,local_bundle_hash:hashFunctionBundle(files),student_auth:'NO CHANGE',files:files.map(f=>({path:f.path,sha256:sha(f.content)}))};
const expected='ce0424f0063b6df70050e325fa55af6a537a53d1464dac752fd99b49275c7c8a';
if(manifest.local_bundle_hash!==expected)throw new Error('Source closure drift from reviewed HEAD');
mkdirSync(join(out,'target/supabase'),{recursive:true});writeFileSync(join(out,'target/supabase/config.toml'),'project_id = "reviewed-required-progress"\n[functions.student-api]\nverify_jwt = false\n');
writeFileSync(join(out,'target-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
// auth file hashes are comparison metadata only: do not deploy student-auth.
const auth=await collectFunctionBundleFiles(app,join(app,'supabase/functions/student-auth/index.ts'));
writeFileSync(join(out,'auth-comparison-only.json'),JSON.stringify({action:'NO CHANGE',local_bundle_hash:hashFunctionBundle(auth),files:auth.map(f=>({path:f.path,sha256:sha(readFileSync(join(app,f.path)))}))},null,2));
console.log('Verified source closure:',files.length,'files;',manifest.local_bundle_hash);
