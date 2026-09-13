import {performance} from 'node:perf_hooks';
import {URL} from 'node:url';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {solveProjectionConstraints} from '../../shared/problems/solvers/projection.ts';
import {phase3Common,phase3Practice,phase3Activities} from '../../shared/problems/templates/phase3.ts';
const results=[];
for(const [width,depth,height]of [[3,3,3],[3,3,4],[4,3,3]]){const r=solveProjectionConstraints({grid:{gridWidth:width,gridDepth:depth,maxHeight:height}});results.push({grid:[width,depth,height],...r,representativeSolutions:undefined});}
const start=performance.now();let problems=0;for(const id of [5,6,7,8])for(const seed of [0,1,2,97,123,314159,2147483647]){problems+=phase3Common(id,seed).length+phase3Practice(id,seed).length;}const problemGenerationMs=performance.now()-start;
for(const id of [5,6,7,8])phase3Activities(id);
const report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),time:new Date().toISOString(),environment:'LOCAL_LOGIC; current Mac CPU, not Chromebook hardware benchmark',results,problems,problemGenerationMs};writeFileSync(new URL('./performance.json',import.meta.url),JSON.stringify(report,null,2));
