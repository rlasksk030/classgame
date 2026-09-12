import process from 'node:process';
import console from 'node:console';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const head=git('rev-parse','HEAD');
const dir=`qa/redesign-browser/${head.slice(0,7)}-${new Date().toISOString().replace(/[:.]/g,'-')}`;
mkdirSync(dir,{recursive:true});
const files=(dir)=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);
const hashFiles=paths=>{const h=createHash('sha256');for(const file of paths.sort()){h.update(file);h.update(readFileSync(file));}return h.digest('hex');};
const caseNames=[...readFileSync('e2e/redesign.spec.ts','utf8').matchAll(/^test\('([^']+)'/gm)].map(m=>m[1]);
const identity={sourceSha256:hashFiles(['src','shared','e2e','scripts'].flatMap(files).concat(['package.json','vite.config.ts','playwright.redesign.config.ts'])),head,time:new Date().toISOString(),workingTree:git('status','--short'),diffSha256:createHash('sha256').update(git('diff')).digest('hex'),category:'UI_WITH_TEST_DATA',remoteWrites:false,persistence:'LOCAL_ONLY'};
writeFileSync(join(dir,'identity.json'),JSON.stringify(identity,null,2));
let phase='build';let exitCode=1;
try{
 const build=spawnSync('npm',['run','build'],{stdio:'inherit'});
 if(build.status!==0)throw new Error('production build failed');
 identity.buildSha256=hashFiles(files('dist'));
 writeFileSync(join(dir,'identity.json'),JSON.stringify(identity,null,2));
 phase='browser';
 const result=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--config','playwright.redesign.config.ts'],{stdio:'inherit',env:{...process.env,SPATIAL_QA_OUTPUT:dir}});
 exitCode=result.status??1;
}catch(error){writeFileSync(join(dir,'runner-error.txt'),String(error));}
const report=existsSync(join(dir,'report.json'))?JSON.parse(readFileSync(join(dir,'report.json'),'utf8')):null;
const cases=[];
function collect(suites){for(const s of suites??[]){for(const spec of s.specs??[])for(const t of spec.tests??[])cases.push({id:spec.title,status:t.status,attempts:t.results?.length??0});collect(s.suites);}}
collect(report?.suites);
for(const name of caseNames)if(!cases.some(c=>c.id===name))cases.push({id:name,status:'NOT_RUN',attempts:0});
const executed=cases.filter(c=>c.attempts>0).length;
const pass=cases.filter(c=>c.status==='expected').length;
const summary={...identity,phase,planned:15,executed,pass,fail:cases.filter(c=>c.status==='unexpected').length,notRun:15-executed,status:executed===0?'BLOCKED':exitCode===0&&pass===15?'PASS':'FAIL',cases,errors:report?.errors??[]};
writeFileSync(join(dir,'summary.json'),JSON.stringify(summary,null,2));
writeFileSync(join(dir,'report.md'),`# Phase 1 browser QA\n\nHEAD: ${head}\n\nCategory: UI_WITH_TEST_DATA / LOCAL_ONLY\n\nStatus: ${summary.status}\n\nPlanned: 15 · executed: ${executed} · PASS: ${pass} · FAIL: ${summary.fail} · NOT_RUN: ${summary.notRun}\n\n${cases.map(c=>`- ${c.id}: ${c.status}`).join('\n')}\n\nDetails: report.json, preview.log, evidence/\n`);
console.log(`Report: ${dir}/report.md`);
process.exitCode=summary.status==='PASS'?0:1;
