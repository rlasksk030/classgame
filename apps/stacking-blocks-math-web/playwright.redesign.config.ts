import { defineConfig } from '@playwright/test';
import { execFileSync } from 'node:child_process';
const head=execFileSync('git',['rev-parse','--short','HEAD'],{encoding:'utf8'}).trim();
const run=process.env.SPATIAL_QA_OUTPUT??`qa/redesign-browser/${head}-${new Date().toISOString().replace(/[:.]/g,'-')}`;
export default defineConfig({testDir:'./e2e',testMatch:['redesign.spec.ts','redesign-phase2.spec.ts','redesign-phase3.spec.ts'],fullyParallel:false,workers:1,timeout:90000,retries:0,outputDir:`${run}/evidence`,reporter:[['list'],['json',{outputFile:`${run}/report.json`}],['html',{outputFolder:`${run}/html`,open:'never'}]],metadata:{head,category:'UI_WITH_TEST_DATA',persistence:'LOCAL_ONLY'},
 use:{baseURL:'http://127.0.0.1:4186',viewport:{width:1366,height:768},launchOptions:{args:['--enable-unsafe-swiftshader']},trace:{mode:'on',screenshots:false,snapshots:true,sources:true},screenshot:'only-on-failure'},
 webServer:{command:'node scripts/redesign-preview.mjs',env:{SPATIAL_QA_OUTPUT:run},url:'http://127.0.0.1:4186',reuseExistingServer:false,timeout:15000}});
