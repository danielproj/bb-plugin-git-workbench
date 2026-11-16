import type { PrMutation } from './pr-contract';
export function repositoryFromRemote(remote:string) {
 const m=remote.trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
 if(!m) throw Error('UNSUPPORTED_REMOTE: Select a GitHub HTTPS or SSH origin.');
 return `${m[1]}/${m[2]}`;
}
export function summarize(p:any){return {number:p.number,title:p.title,body:p.body??'',state:p.state,url:p.html_url,draft:p.draft,head:p.head.sha,base:p.base.ref,branch:p.head.label,author:p.user?.login??'',mergeable:p.mergeable,mergeState:p.mergeable_state??'unknown'};}
export function assertHead(p:any,op:Exclude<PrMutation,{action:'create'}>){if(p.head.sha!==op.expectedHead)throw Error('STALE_HEAD: Refresh the PR; drafts have not been sent.');}
export function mergeReadiness(p:any){
 if(p.state!=='open')return 'Pull request is not open';
 if(p.draft)return 'Pull request is a draft';
 if(p.mergeable!==true)return 'Conflicts or mergeability unknown';
 if(p.mergeable_state!=='clean')return `Repository readiness: ${p.mergeable_state??'unknown'}`;
 return null;
}
export function bounded(items:any[],page=1){return {items:items.slice(0,50),coverageComplete:page===1&&items.length<50,nextPage:items.length===50?page+1:null,text:'',truncated:items.length>=50};}

// The commit oid must match the list snapshot before health can describe that head.
export function inboxSummary(p:any,n?:any):import('./pr-contract').PrInboxSummary {
 const same=!!n && (!p.head?.sha || n.headRefOid===p.head.sha);
 const commit=n?.commits?.nodes?.[0]?.commit;
 const health=same&&commit?.oid===n.headRefOid;
 return {number:p.number,title:String(p.title||'').slice(0,1000),preview:String(p.body||'').replace(/<!--[\s\S]*?(?:-->|$)/g,'').replace(/<[^>]*>/g,' ').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[#*`>]/g,'').replace(/\s+/g,' ').trim().slice(0,320),state:n?.merged||p.merged_at?'merged':p.state==='closed'?'closed':p.draft?'draft':p.state==='open'?'open':'unknown',author:p.user?.login||n?.author?.login||'Unknown author',branch:p.head?.label||n?.headRefName||'Branch unavailable',base:p.base?.ref||n?.baseRefName||'unknown',labels:(p.labels||[]).slice(0,10).map((x:any)=>typeof x==='string'?x:x.name),labelsTruncated:(p.labels||[]).length>10,updatedAt:p.updated_at||'',ci:health?(commit.statusCheckRollup?.state||'No checks reported'):'Unavailable',review:same?(n.reviewDecision||'Not reported'):'Unavailable',healthAvailable:!!health};
}
