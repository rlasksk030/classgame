import { buildingContent, EMPTY_BUILDING, normalizeBuilding, validBuilding, type Building } from '../../../shared/activities.ts';
export const SAVE_TEXT = {
 dirty:'아직 저장되지 않은 내용이 있어요', saving:'저장하고 있어요…',
 local:'이 기기에 임시 저장했어요. 서버에는 아직 저장되지 않았어요',
 saved:'저장 완료! 다른 기기에서도 이어서 할 수 있어요',
 failed:'저장하지 못했어요. 내용을 유지하고 있으니 다시 시도해 주세요',
 completed:'작품 완성! 공유할 수 있어요',
};
export type SaveStatus = 'loading' | 'dirty' | 'local' | 'saving' | 'saved' | 'failed' | 'completed' | 'conflict';
export interface BuildingState { building:Building; status:SaveStatus; ready:boolean; revision:number; activityContract:number; error:string; conflict:Building|null; confirmed:Building|null }
export interface BuildingTransport { get():Promise<{building:Building|null;activityContract?:number}>; save(building:Building):Promise<{version:number}> }
export interface DraftStore { read():Building|null; write(value:Building):boolean; clear():void }
export class SaveConflict extends Error { readonly server:Building; constructor(server:Building){super('VERSION_CONFLICT');this.server=server;} }
/** Lost responses are acknowledged only when the exact next version is read back. */
export async function confirmedSave(value:Building, api:BuildingTransport, requireTimestamp=true):Promise<Building> {
 let expected=value.version+1, writeError:unknown;
 try {const reply=await api.save(value);expected=reply.version;if(!Number.isInteger(expected)||expected!==value.version+1)throw Error('INVALID_SAVE_VERSION');}
 catch(error){writeError=error;}
 const {building:server}=await api.get();
 if(server&&server.version===expected&&buildingContent(server)===buildingContent(value)&&(!requireTimestamp||Boolean(server.updated_at&&Number.isFinite(Date.parse(server.updated_at))))) return server;
 if(server&&server.version!==value.version)throw new SaveConflict(server);
 throw writeError??Error('SAVE_NOT_CONFIRMED');
}
export function saveErrorText(error:unknown) {
 const code=typeof error==='object'&&error&&'code' in error?String(error.code):error instanceof Error?error.message:'';
 const messages:Record<string,string>={LESSON_LOCKED:'선생님이 아직 열지 않은 차시예요.',INVALID_BUILDING:'블록 위치와 실제 사용한 층의 설명을 확인해 주세요.',DB_PERMISSION:'선생님이 연결 설정을 확인해야 해요.',UPDATE_REQUIRED:'선생님이 연결하고 업데이트를 완료해야 해요.',SESSION_INVALID:'다시 로그인해 주세요.',SAVE_NOT_CONFIRMED:'서버에서 저장 내용을 아직 확인하지 못했어요.'};
 return messages[code]??'연결을 확인한 뒤 다시 시도해 주세요.';
}
/** A single writer queues manual saves behind autosaves and never rebases a conflict silently. */
export class BuildingSession {
 state:BuildingState={building:EMPTY_BUILDING,status:'loading',ready:false,revision:0,activityContract:1,error:'',conflict:null,confirmed:null};
 private dirty=false;
 private flight:Promise<void>|null=null;
 private stopped=false;
 private api:BuildingTransport; private store:DraftStore; private changed:(state:BuildingState)=>void;
 constructor(api:BuildingTransport,store:DraftStore,changed:(state:BuildingState)=>void){this.api=api;this.store=store;this.changed=changed;}
 private emit(patch:Partial<BuildingState>){this.state={...this.state,...patch};if(!this.stopped)this.changed(this.state);}
 stop(){this.stopped=true;}
 async load(){
  const draft=this.store.read();
  try{
   const {building:server,activityContract=1}=await this.api.get();if(this.stopped)return;
   const recovered=Boolean(draft&&server&&server.version>=draft.version&&server.version<=draft.version+1&&buildingContent(draft)===buildingContent(server));
   if(recovered)this.store.clear();
   const pending=recovered?null:draft;
   const value=normalizeBuilding(pending??server??{...EMPTY_BUILDING,max_height:activityContract>=2?10:3,layer_notes:Array(activityContract>=2?10:3).fill('')},activityContract>=2?10:3);
   this.dirty=Boolean(pending);
   const conflict=pending&&pending.version!==(server?.version??0)?server:null;
   this.emit({building:value,ready:true,activityContract,confirmed:server,conflict,status:conflict?'conflict':pending?'local':server?.submitted?'completed':server?'saved':'dirty'});
  }catch(error){if(this.stopped)return;this.dirty=Boolean(draft);this.emit({building:draft??EMPTY_BUILDING,ready:Boolean(draft),status:draft?'local':'failed',error:saveErrorText(error)});}
 }
 edit(building:Building){
  this.dirty=true;const local=this.store.write(building);
  this.emit({building,revision:this.state.revision+1,status:this.state.conflict?'conflict':local?'local':'dirty',error:''});
 }
 async save(submit=false,manual=true):Promise<void>{
  if(this.stopped||!this.state.ready||this.state.conflict)return;
  if(this.flight){await this.flight;if(!this.stopped)return this.save(submit,manual);return;}
  if(manual&&!this.state.confirmed)this.dirty=true;
  if(!this.dirty&&(!submit||this.state.building.submitted)){
   if(!manual)return;
   const checked=this.state.building, revision=this.state.revision;
   this.emit({status:'saving',error:''});
   this.flight=(async()=>{
    try{
     const {building:server}=await this.api.get();
     if(this.stopped)return;
     if(!server)throw Error('SAVE_NOT_CONFIRMED');
     if(server.version!==checked.version)throw new SaveConflict(server);
     // Normalizing a legacy three-floor server design adds only blank UI fields.
     if(buildingContent(normalizeBuilding(server,this.state.activityContract>=2?10:3))!==buildingContent(checked)||(this.state.activityContract>=2&&!server.updated_at))throw Error('SAVE_NOT_CONFIRMED');
     this.emit({confirmed:server,status:this.state.revision!==revision?'local':server.submitted?'completed':'saved'});
    }catch(error){if(!this.stopped)this.failure(error);}
   })();
   try{await this.flight;}finally{this.flight=null;}
   return;
  }
  const sent={...this.state.building,submitted:submit||this.state.building.submitted};
  if(!validBuilding(sent,sent.submitted)){this.emit({status:'failed',error:'이름·설계 이유·설명과 실제 사용한 층의 설명을 확인해 주세요.'});return;}
  const revision=this.state.revision;
  this.store.write(sent);
  this.emit({status:'saving',error:''});
  this.flight=(async()=>{
   try{
    const confirmed=await confirmedSave(sent,this.api,this.state.activityContract>=2);
    // A new page/session owns the shared draft after stop. Leave its copy intact.
    if(this.stopped)return;
    const unchanged=this.state.revision===revision;
    this.dirty=!unchanged;
    const building=unchanged?confirmed:{...this.state.building,version:confirmed.version};
    if(unchanged)this.store.clear();else this.store.write(building);
    this.emit({building,confirmed,status:unchanged?confirmed.submitted?'completed':'saved':'local'});
   }catch(error){if(!this.stopped)this.failure(error);}
  })();
  try{await this.flight;}finally{this.flight=null;}
 }
 private failure(error:unknown){this.emit(error instanceof SaveConflict?{conflict:error.server,status:'conflict',error:'다른 기기에서 수정했어요. 두 설계를 비교하고 선택해 주세요.'}:{status:'failed',error:saveErrorText(error)});}
 useServer(){const server=this.state.conflict;if(!server)return;this.store.clear();this.dirty=false;this.emit({building:normalizeBuilding(server,this.state.activityContract>=2?10:3),confirmed:server,conflict:null,status:server.submitted?'completed':'saved',error:''});}
 async useLocal(){const server=this.state.conflict;if(!server)return;const local={...this.state.building,version:server.version};this.emit({conflict:null});this.edit(local);await this.save(false,true);}
}
