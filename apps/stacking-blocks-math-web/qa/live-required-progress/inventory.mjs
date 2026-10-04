/* global process, console */
import ts from 'typescript';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const calls=[];
function walkDir(dir){for(const item of readdirSync(dir,{withFileTypes:true})){const path=join(dir,item.name);if(item.isDirectory())walkDir(path);else if(/\.tsx?$/.test(path))scan(path);}}
function scan(path){const source=readFileSync(path,'utf8');const sf=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,path.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 function visit(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&['from','rpc'].includes(n.expression.name.text)){
  const method=n.expression.name.text;const arg=n.arguments[0];const literal=arg&&ts.isStringLiteralLike(arg)?arg.text:null;
  const receiver=n.expression.expression.getText(sf);
  if(literal&&(literal.startsWith('sb_')||receiver.endsWith('.storage'))){
   let top=n;while(top.parent&&(ts.isPropertyAccessExpression(top.parent)||ts.isCallExpression(top.parent)))top=top.parent;
   const line=sf.getLineAndCharacterOfPosition(n.getStart()).line+1;
   const methods=[];let cursor=top;
   while(ts.isCallExpression(cursor)&&ts.isPropertyAccessExpression(cursor.expression)){
    methods.unshift({method:cursor.expression.name.text,args:cursor.arguments.map(a=>a.getText(sf))});cursor=cursor.expression.expression;
   }
   calls.push({path,line,receiver,kind:receiver.endsWith('.storage')?'storage':method,target:literal,methods,source:top.getText(sf)});
  }else if(method==='rpc'&&!receiver.endsWith('Array'))calls.push({path,line:sf.getLineAndCharacterOfPosition(n.getStart()).line+1,receiver,kind:'dynamic-rpc',target:arg?.getText(sf)});
 }ts.forEachChild(n,visit);}visit(sf);
}
for(const dir of ['supabase/functions','src','shared'])walkDir(dir);
writeFileSync(process.argv[2]??'runtime-db-calls.json',JSON.stringify({head:'5a90a242925e2d62af0376f6e99d9416c21248e4',calls,tables:[...new Set(calls.filter(c=>c.kind==='from').map(c=>c.target))].sort(),rpcs:[...new Set(calls.filter(c=>c.kind==='rpc').map(c=>c.target))].sort()},null,2)+'\n');
console.log(JSON.stringify({calls:calls.length,tables:[...new Set(calls.filter(c=>c.kind==='from').map(c=>c.target))].sort(),rpcs:[...new Set(calls.filter(c=>c.kind==='rpc').map(c=>c.target))].sort()}));
