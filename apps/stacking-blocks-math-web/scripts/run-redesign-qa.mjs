import process from 'node:process';
import console from 'node:console';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const head=git('rev-parse','HEAD');
const dir=process.env.SPATIAL_QA_OUTPUT??`qa/redesign-browser/${head.slice(0,7)}-${new Date().toISOString().replace(/[:.]/g,'-')}`;
if(existsSync(dir)&&readdirSync(dir).length)throw new Error('QA output already exists; use a new directory to preserve evidence');
mkdirSync(dir,{recursive:true});
function run(command,args,name,env=process.env){
 const result=spawnSync(command,args,{encoding:'utf8',env,maxBuffer:64*1024*1024});
 writeFileSync(join(dir,`${name}.stdout.log`),result.stdout??'');
 writeFileSync(join(dir,`${name}.stderr.log`),(result.stderr??'')+(result.error?String(result.error):''));
 process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');return result;
}
const files=(dir)=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);
const hashFiles=paths=>{const h=createHash('sha256');for(const file of paths.sort()){h.update(file);h.update(readFileSync(file));}return h.digest('hex');};
const caseNames=['e2e/redesign.spec.ts','e2e/redesign-phase2.spec.ts','e2e/redesign-phase3.spec.ts'].flatMap(file=>[...readFileSync(file,'utf8').matchAll(/^test\('([^']+)'/gm)].map(m=>m[1]));
const identity={sourceSha256:hashFiles(['src','shared','e2e','scripts'].flatMap(files).concat(['package.json','vite.config.ts','playwright.redesign.config.ts'])),head,time:new Date().toISOString(),workingTree:git('status','--short'),diffSha256:createHash('sha256').update(git('diff')).digest('hex'),category:'UI_WITH_TEST_DATA',remoteWrites:false,persistence:'LOCAL_ONLY'};
writeFileSync(join(dir,'identity.json'),JSON.stringify(identity,null,2));
let phase='build';let exitCode=1;
try{
 const build=run('npm',['run','build'],'build');
 if(build.status!==0)throw new Error('production build failed');
 identity.buildSha256=hashFiles(files('dist'));
 writeFileSync(join(dir,'identity.json'),JSON.stringify(identity,null,2));
 phase='browser';
 const result=run(process.execPath,['node_modules/@playwright/test/cli.js','test','--config','playwright.redesign.config.ts'],'playwright',{...process.env,SPATIAL_QA_OUTPUT:dir});
 exitCode=result.status??1;
}catch(error){writeFileSync(join(dir,'runner-error.txt'),String(error));}
const report=existsSync(join(dir,'report.json'))?JSON.parse(readFileSync(join(dir,'report.json'),'utf8')):null;
const cases=[];
function collect(suites){for(const s of suites??[]){for(const spec of s.specs??[])for(const t of spec.tests??[])cases.push({id:spec.title,status:t.status,attempts:t.results?.length??0});collect(s.suites);}}
collect(report?.suites);
for(const name of caseNames)if(!cases.some(c=>c.id===name))cases.push({id:name,status:'NOT_RUN',attempts:0});
const executed=cases.filter(c=>c.attempts>0).length;
const pass=cases.filter(c=>c.status==='expected').length;
const summary={...identity,phase,planned:caseNames.length,executed,pass,fail:cases.filter(c=>c.status==='unexpected').length,notRun:caseNames.length-executed,status:executed===0?'BLOCKED':exitCode===0&&pass===caseNames.length?'PASS':'FAIL',cases,errors:report?.errors??[]};
writeFileSync(join(dir,'summary.json'),JSON.stringify(summary,null,2));
writeFileSync(join(dir,'report.md'),`# Redesign browser QA\n\nHEAD: ${head}\n\nCategory: UI_WITH_TEST_DATA / LOCAL_ONLY\n\nStatus: ${summary.status}\n\nPlanned: ${caseNames.length} · executed: ${executed} · PASS: ${pass} · FAIL: ${summary.fail} · NOT_RUN: ${summary.notRun}\n\n${cases.map(c=>`- ${c.id}: ${c.status}`).join('\n')}\n\nDetails: report.json, preview.log, evidence/\n`);
console.log(`Report: ${dir}/report.md`);
process.exitCode=summary.status==='PASS'?0:1;
