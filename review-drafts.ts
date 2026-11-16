export type Inline={path:string;line:number;side:'LEFT'|'RIGHT';body:string};
export type ReviewDraft={drafts:Inline[];head:string;body:string;event:'COMMENT'|'APPROVE'|'REQUEST_CHANGES'};
// When browser storage is unavailable, keep drafts and receipts for this page lifetime.
const fallback=new Map<string,ReviewDraft|null>();
export function loadReview(key:string):ReviewDraft|null{
 if(fallback.has(key))return fallback.get(key)!;
 try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}
}
export function saveReview(key:string,draft:ReviewDraft|null){
 try{if(draft)localStorage.setItem(key,JSON.stringify(draft));else localStorage.removeItem(key);fallback.delete(key)}catch{fallback.set(key,draft)}
}
// Module lifetime outlives view mounts. A remounted view shares the reservation.
const pending=new Set<string>();
const warnings=new Map<string,string>();
export function reviewDeliveryWarning(key:string,message?:string){if(message){warnings.set(key,message);notify(key)}return warnings.get(key)}
const listeners=new Set<(key:string,receipt:boolean)=>void>();
export const reviewPending=(key:string)=>pending.has(key);
export function watchReviews(listener:(key:string,receipt:boolean)=>void){listeners.add(listener);return ()=>{listeners.delete(listener)}}
function notify(key:string,receipt=false){for(const listener of listeners)listener(key,receipt)}
export function reserveReview(key:string){if(pending.has(key))return false;warnings.delete(key);pending.add(key);notify(key);return true}
export function releaseReview(key:string){pending.delete(key);notify(key)}
export function reconcileReview(current:ReviewDraft,sent:ReviewDraft):ReviewDraft{
 const remaining=[...current.drafts];
 for(const draft of sent.drafts){const i=remaining.findIndex(d=>JSON.stringify(d)===JSON.stringify(draft));if(i>=0)remaining.splice(i,1)}
 return {...current,drafts:remaining,body:current.body===sent.body?'':current.body};
}
export function acknowledgeReview(key:string,sent:ReviewDraft){
 const current=loadReview(key);
 if(current){const next=reconcileReview(current,sent);saveReview(key,next.drafts.length||next.body?next:null)}
 notify(key,true);
}
