export type ObservedView='top'|'front'|'side'|'free';
/** Classify actual camera offset from its target, independent of the requested button. */
export function observedView(offset:{x:number;y:number;z:number}):ObservedView {
 const length=Math.hypot(offset.x,offset.y,offset.z);if(!length)return 'free';
 const x=offset.x/length,y=offset.y/length,z=offset.z/length;
 if(y>0.999)return 'top';
 if(z< -0.999&&Math.abs(y)<0.02)return 'front';
 if(x>0.999&&Math.abs(y)<0.02)return 'side';
 return 'free';
}
