import test from 'node:test';
import assert from 'node:assert/strict';
import {BuildingSession,confirmedSave,SaveConflict,type BuildingTransport} from '../src/features/activities/buildingSave.ts';
import {EMPTY_BUILDING,type Building} from '../shared/activities.ts';
const value={...EMPTY_BUILDING,building_name:'전시관',reason:'공간 비교',description:'전시',blocks:[{x:0,y:0,z:0}],layer_notes:['로비\n안내',...Array(9).fill('')]};
function fixture(){let server:Building|null=null,draft:Building|null=null,writes=0;
 const api:BuildingTransport={get:async()=>({building:server,activityContract:2}),save:async building=>{writes++;if((server?.version??0)!==building.version)throw Object.assign(Error('conflict'),{code:'VERSION_CONFLICT'});server={...building,version:building.version+1,updated_at:new Date().toISOString()};return {version:server.version};}};
 const session=new BuildingSession(api,{read:()=>draft,write:b=>{draft=structuredClone(b);return true;},clear:()=>{draft=null;}},()=>{});
 return {api,session,get server(){return server;},set server(b){server=b;},get draft(){return draft;},get writes(){return writes;}};
}
test('response loss is confirmed by exact persisted content, next version and server time',async()=>{const f=fixture(),save=f.api.save;f.api.save=async b=>{await save(b);throw Error('network');};const result=await confirmedSave(value,f.api);assert.equal(result.version,1);assert.ok(result.updated_at);});
test('returned success without matching persistence is never saved',async()=>{const f=fixture();f.api.save=async()=>({version:1});await assert.rejects(()=>confirmedSave(value,f.api),/SAVE_NOT_CONFIRMED/);});
test('manual save queues edits behind a running autosave without losing either revision',async()=>{
 const f=fixture();await f.session.load();f.session.edit(value);let release!:()=>void;const barrier=new Promise<void>(r=>release=r),save=f.api.save;let first=true;
 f.api.save=async b=>{if(first){first=false;await barrier;}return save(b);};
 const auto=f.session.save(false,false);f.session.edit({...value,description:'두 번째 편집'});const manual=f.session.save();release();await Promise.all([auto,manual]);
 assert.equal(f.writes,2);assert.equal(f.server?.description,'두 번째 편집');assert.equal(f.server?.version,2);assert.equal(f.draft,null);assert.equal(f.session.state.status,'saved');
});
test('autosave failure keeps local draft and manual retry succeeds',async()=>{const f=fixture();await f.session.load();f.session.edit(value);const save=f.api.save;f.api.save=async()=>{throw Error('offline');};await f.session.save(false,false);assert.equal(f.session.state.status,'failed');assert.deepEqual(f.draft,value);f.api.save=save;await f.session.save();assert.equal(f.session.state.status,'saved');assert.equal(f.draft,null);});
test('concurrent device edit requires comparison and explicit choice; another race conflicts again',async()=>{
 const f=fixture();await f.session.load();f.session.edit(value);f.server={...value,description:'다른 기기',version:1,updated_at:new Date().toISOString()};await f.session.save();assert.equal(f.session.state.status,'conflict');assert.equal(f.server.description,'다른 기기');assert.ok(f.draft);f.server={...f.server,version:2};await f.session.useLocal();assert.equal(f.session.state.status,'conflict');assert.equal(f.server.version,2);await f.session.useLocal();assert.equal(f.server.description,value.description);assert.equal(f.server.version,3);
});
test('reload after server commit but before response recovers without an extra write',async()=>{const f=fixture();await f.session.load();f.session.edit(value);await f.api.save(value);await f.session.load();assert.equal(f.session.state.status,'saved');assert.equal(f.draft,null);assert.equal(f.writes,1);});
test('duplicate complete clicks do not rewrite completed project or re-award',async()=>{const f=fixture();await f.session.load();f.session.edit(value);await Promise.all([f.session.save(true),f.session.save(true)]);assert.equal(f.writes,1);assert.equal(f.session.state.status,'completed');});
test('clean manual save checks server and detects cross-device drift',async()=>{const f=fixture();await f.session.load();f.session.edit(value);await f.session.save();await f.session.save();assert.equal(f.writes,1);f.server={...f.server!,version:2,description:'다른 설계'};await f.session.save();assert.equal(f.session.state.status,'conflict');});
test('mismatching response loss never accepts another design',async()=>{const f=fixture();f.server={...value,version:1,description:'다른 설계',updated_at:new Date().toISOString()};await assert.rejects(()=>confirmedSave(value,f.api),SaveConflict);});

test('leaving a page during save never clears a newer session draft',async()=>{
 const f=fixture();await f.session.load();f.session.edit(value);let release!:()=>void;const barrier=new Promise<void>(r=>release=r),save=f.api.save;
 f.api.save=async b=>{await barrier;return save(b);};const pending=f.session.save();f.session.stop();
 const newer={...value,description:'새 페이지에서 편집'};
 f.session.edit(newer);release();await pending;assert.deepEqual(f.draft,newer);
});
test('editing during clean readback stays pending and a manual click queues its write',async()=>{
 const f=fixture();await f.session.load();f.session.edit(value);await f.session.save();let release!:()=>void;const barrier=new Promise<void>(r=>release=r),get=f.api.get;let first=true;
 f.api.get=async()=>{if(first){first=false;await barrier;}return get();};const checking=f.session.save();f.session.edit({...f.session.state.building,description:'읽는 동안 수정'});const pending=f.session.save();release();await Promise.all([checking,pending]);
 assert.equal(f.writes,2);assert.equal(f.server?.description,'읽는 동안 수정');assert.equal(f.session.state.status,'saved');
});

test('legacy Edge retains three-floor saving with exact readback even when it has no server-time field',async()=>{
 const f=fixture(),get=f.api.get,save=f.api.save;f.api.get=async()=>({...await get(),activityContract:1});
 f.api.save=async b=>{const reply=await save(b);delete f.server!.updated_at;return reply;};
 await f.session.load();assert.equal(f.session.state.building.max_height,3);
 f.session.edit({...value,max_height:3,layer_notes:['로비','안내','']});await f.session.save();assert.equal(f.session.state.status,'saved');assert.equal(f.server?.max_height,3);assert.equal(f.session.state.confirmed?.updated_at,undefined);
 await f.session.save();assert.equal(f.writes,1);
});
