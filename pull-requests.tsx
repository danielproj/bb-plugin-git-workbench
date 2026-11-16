import { useEffect, useRef, useState } from 'react';
import { Markdown } from '@get-bb/plugin-sdk/app';
import { FileTree } from './file-tree';
import { Checks } from './checks';
import { prActionStyle } from './action-style';
import { z } from 'zod';
import { prResult } from './pr-contract';
import { viewCache, cacheKey, prViewSchema, syncTime } from './view-cache';
import type { PrMutation, PrRead, PrResult, PrInboxSummary } from './pr-contract';
export type PrApi={list:(query:{state:'open'|'closed'|'all';search:string;page:number})=>Promise<PrResult>;read:(read:PrRead)=>Promise<PrResult>;mutate:(op:PrMutation)=>Promise<PrResult & {applied:true;refreshError?:string}>};
import { type Inline, type ReviewDraft, loadReview, saveReview, reviewPending, watchReviews, reserveReview, releaseReview, acknowledgeReview, reviewDeliveryWarning } from './review-drafts';
export function blockers(d:PrResult['detail'], data:Record<string,PrResult>):string[]{
 if(!d)return ['Loading authoritative PR details'];
 const p=d.pr,c=data.checks,t=data.threads; const out:string[]=[];
 if(p.state!=='open')out.push('Pull request is not open'); if(p.draft)out.push('Draft needs to be marked ready');
 if(!p.mergeable||p.mergeState.toLowerCase()!=='clean')out.push(`Branch: ${p.mergeState || 'unknown'}`);
 if(!c?.coverageComplete||c.checks?.requiredCoverage!=='complete'||c.checks.head!==p.head)out.push('Check requirements incomplete or unknown');
 for(const check of c?.checks?.contexts||[]){const s=(check.conclusion||check.state||check.status||'unknown').toLowerCase();if(check.isRequired&&!['success','neutral','skipped'].includes(s))out.push(`Required: ${check.name||check.context} · ${s}`);}
 if(!t?.coverageComplete)out.push('Discussion coverage incomplete');
 if(t?.threads?.some(x=>!x.isResolved))out.push('Unresolved review discussions');
 if(d.permissions.pullRequest.reviewDecision==='CHANGES_REQUESTED'||d.permissions.pullRequest.reviewDecision==='REVIEW_REQUIRED')out.push(`Review: ${d.permissions.pullRequest.reviewDecision}`);
 if(!['ADMIN','MAINTAIN','WRITE'].includes(d.permissions.viewerPermission||''))out.push('Merge permission unavailable');
 return out;
}
type Tone = 'neutral'|'good'|'review'|'warn'|'bad';
type HealthItem = {label:string;detail:string;tone:Tone;symbol:string;section:string};
const humanize = (value:string) => value.toLowerCase().replaceAll('_',' ').replace(/^./,s=>s.toUpperCase());
const names = (value:unknown,key:string):string[] => Array.isArray(value)
 ? value.flatMap(x=>x&&typeof x==='object'&&typeof x[key]==='string'?[x[key]]:[]) : [];
function inboxTone(value:string):Tone {
 const state=value.toLowerCase();
 if(/failure|failed|error|changes_requested/.test(state))return 'bad';
 if(/pending|waiting|in_progress/.test(state))return 'warn';
 if(/success|approved/.test(state))return 'good';
 if(/review_required/.test(state))return 'review';
 return 'neutral';
}
/** Display status never replaces the conservative, head-pinned merge guards. */
export function studioHealth(detail:PrResult['detail'],data:Record<string,PrResult>):HealthItem[] {
 const p=detail?.pr,checks=data.checks?.checks;
 const states=[...(checks?.checkRuns||[]).map(c=>(c.conclusion||c.status).toLowerCase()),...(checks?.statuses||[]).map(c=>c.state.toLowerCase())];
 const required=(checks?.contexts||[]).filter(c=>c.isRequired).map(c=>(c.conclusion||c.state||c.status||'unknown').toLowerCase());
 const failing=(s:string)=>['failure','error','timed_out','cancelled','action_required'].includes(s);
 const pending=(s:string)=>['pending','queued','in_progress','waiting','requested'].includes(s);
 const failed=states.filter(failing).length,waiting=states.filter(pending).length,passed=states.filter(s=>s==='success').length;
 const fresh=!!p&&checks?.head===p.head;
 const complete=!!data.checks?.coverageComplete&&checks?.requiredCoverage==='complete';
 let ci:HealthItem={label:'Loading checks…',detail:'Waiting for current-head checks',tone:'neutral',symbol:'◌',section:'checks'};
 if(checks){
  ci.detail=checkSummary(data.checks);
  if(!fresh)ci.label='Checks from another head';
  else if(failed||required.some(failing))Object.assign(ci,{label:failed?`${failed} check${failed===1?'':'s'} failing`:'Required checks failing',tone:'bad',symbol:'!'});
  else if(waiting||required.some(pending))Object.assign(ci,{label:waiting?`${waiting} check${waiting===1?'':'s'} pending`:'Required checks pending',tone:'warn',symbol:'◷'});
  else if(!complete)ci.label='Checks incomplete';
  else if([...states,...required].some(s=>!['success','neutral','skipped'].includes(s)))ci.label='Check status unknown';
  else if(passed)Object.assign(ci,{label:`${passed} check${passed===1?'':'s'} passed`,tone:'good',symbol:'✓'});
  else ci.label=states.length?'Neutral / skipped checks':'No checks reported';
 }
 const decision=detail?.permissions.pullRequest.reviewDecision;
 const review:HealthItem={label:decision?humanize(decision):detail?'Review not reported':'Loading review…',detail:decision?'Reported by GitHub':'Approval has not been reported',tone:decision==='APPROVED'?'good':decision==='CHANGES_REQUESTED'?'bad':decision==='REVIEW_REQUIRED'?'review':'neutral',symbol:decision==='APPROVED'?'✓':'◉',section:'review'};
 const threads=data.threads,open=threads?.threads?.filter(t=>!t.isResolved).length||0;
 const discussions:HealthItem={label:!threads?'Loading discussions…':open?`${open} unresolved ${open===1?'discussion':'discussions'}`:threads.coverageComplete?'All discussions resolved':'Discussions incomplete',detail:threads?.coverageComplete?'Complete discussion coverage':'Unseen discussions may remain',tone:open?'warn':threads?.coverageComplete?'good':'neutral',symbol:open?'◌':threads?.coverageComplete?'✓':'◌',section:'threads'};
 const merged=!!(detail?.data as any)?.merged;
 const branch:HealthItem={label:'Merge status unknown',detail:p?`Head ${p.head.slice(0,12)}`:'Loading branch status',tone:'neutral',symbol:'⑂',section:'commits'};
 if(merged)Object.assign(branch,{label:`Merged into ${p?.base||'base'}`,tone:'review'});
 else if(p?.state==='closed')branch.label='Pull request closed';
 else if(p?.mergeable===false)Object.assign(branch,{label:'Merge conflicts',tone:'bad'});
 else if(p?.mergeable&&p.mergeState.toLowerCase()==='clean')Object.assign(branch,{label:'No merge conflicts',tone:'good'});
 else if(p?.mergeState&&p.mergeState.toLowerCase()!=='unknown')Object.assign(branch,{label:`Branch ${humanize(p.mergeState).toLowerCase()}`,tone:'warn'});
 return [ci,review,discussions,branch];
}
export function patchLines(patch:string){let left=0,right=0;return patch.split('\n').map(text=>{const h=/^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(text);if(h){left=+h[1];right=+h[2];return {text,left:null,right:null}}if(text.startsWith('\\'))return {text,left:null,right:null};const row={text,left:text.startsWith('+')?null:left++,right:text.startsWith('-')?null:right++};return row})}
export function splitPatch(patch:string){
 const lines=patchLines(patch), rows:{left:typeof lines[number]|null;right:typeof lines[number]|null;header?:string}[]=[];
 for(let i=0;i<lines.length;){
 const row=lines[i];
 if(row.left===null&&row.right===null){rows.push({left:null,right:null,header:row.text});i++;continue}
 if(row.text.startsWith('-')||row.text.startsWith('+')){
 const old:typeof lines=[], next:typeof lines=[];
 while(i<lines.length&&/^[+-]/.test(lines[i].text)){const r=lines[i++];(r.text.startsWith('-')?old:next).push(r)}
 for(let n=0;n<Math.max(old.length,next.length);n++)rows.push({left:old[n]||null,right:next[n]||null});
 }else{rows.push({left:row,right:row});i++}
 }return rows;
}
export function PatchDiff({patch,split}:{patch:string;split:boolean}){
 return <div className={split?'pr-diff split':'pr-diff'}>{split?splitPatch(patch).map((r,i)=>r.header!==undefined?<pre className="pr-hunk" key={i}>{r.header}</pre>:<div className="pr-split-row" key={i}>{(['left','right'] as const).map(side=>{const cell=r[side];return <pre key={side} className={!cell?'blank':cell.text.startsWith('+')?'add':cell.text.startsWith('-')?'del':''}><span className="pr-line">{cell?.[side]??''}</span> {cell?.text||''}</pre>})}</div>):patchLines(patch).map((r,i)=>r.left===null&&r.right===null?<pre className="pr-hunk" key={i}>{r.text}</pre>:<pre className={r.text.startsWith('+')?'add':r.text.startsWith('-')?'del':''} key={i}><span className="pr-line">{r.left??'–'} / {r.right??'–'}</span> {r.text}</pre>)}</div>
}
export function PrInbox({items,onSelect}:{items:PrInboxSummary[];onSelect:(number:number)=>void}){
 return <div className="pr-inbox-list" aria-label="Pull request results">{items.map(p=><button className="pr-inbox-row" key={p.number} onClick={()=>onSelect(p.number)}>
 <span className="pr-inbox-avatar" aria-hidden="true">{p.author.slice(0,2).toUpperCase()}</span>
 <span className="pr-inbox-content"><span className="pr-inbox-title"><strong>{p.title}</strong><span className={'pr-inbox-state '+p.state}>{p.state}</span></span>
 <span className="pr-inbox-meta">#{p.number} · {p.author} · <span>{p.branch} → {p.base}</span></span>
 {p.preview&&<span className="pr-inbox-preview">{p.preview}</span>}
 <span className="pr-inbox-tags">{p.labels.map((l,i)=><span key={i}>{l}</span>)}{p.labelsTruncated&&<span>More labels…</span>}</span>
 <span className="pr-inbox-health"><span data-tone={inboxTone(p.ci)}>CI · {p.ci.replaceAll('_',' ').toLowerCase()}</span><span data-tone={inboxTone(p.review)}>Review · {p.review.replaceAll('_',' ').toLowerCase()}</span><time dateTime={p.updatedAt}>Updated {p.updatedAt?new Date(p.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'unknown'}</time></span>
 </span><span className="pr-inbox-arrow" aria-hidden="true">↗</span></button>)}</div>
}
const prDataSchema=z.record(z.string(),prResult);
class PrRefreshError extends Error {constructor(readonly data:Record<string,PrResult>,readonly failed:string[]){super(`Could not refresh ${failed.join(', ')}. Showing the last available data.`);}}
export function PullRequests({api,scope="repository",cacheScope=scope,enabled=true}:{api:PrApi;scope?:string;cacheScope?:string;enabled?:boolean}){
 const cache=viewCache(),viewKey=cacheKey('pr-view',cacheScope);
 const [boot]=useState(()=>cache.get(viewKey,prViewSchema)?.value);
 const [listLoading,setListLoading]=useState(true);const [listError,setListError]=useState('');const [listPage,setListPage]=useState(boot?.listPage||1);
 const [filter,setFilter]=useState<string>(boot?.filter||'open');const [search,setSearch]=useState(boot?.search||'');const [debouncedSearch,setDebouncedSearch]=useState(boot?.search||'');const [number,setNumber]=useState(boot?.number||0);
 const listKey=cacheKey('pr-list',cacheScope,filter,search,listPage),detailKey=cacheKey('pr-detail',cacheScope,number);
 const cachedList=cache.get(listKey,prResult),cachedData=cache.get(detailKey,prDataSchema);
 const [liveList,setLiveList]=useState<{key:string;value:PrResult}|null>(null);
 const list=liveList?.key===listKey?liveList.value:cachedList?.value;
 const [liveData,setLiveData]=useState<{key:string;value:Record<string,PrResult>}|null>(null);
 const data=liveData?.key===detailKey?liveData.value:cachedData?.value||{};
 const [fresh,setFresh]=useState<{key:string;kinds:string[]}>({key:'',kinds:[]});
 const freshKinds=fresh.key===detailKey?fresh.kinds:[];
 const canAct=enabled&&freshKinds.includes('detail');
 const dataFresh=enabled&&['detail','files','threads','comments','commits','checks','metadata'].every(k=>freshKinds.includes(k));
 const [refreshing,setRefreshing]=useState(false);
 const [error,setError]=useState('');const [notice,setNotice]=useState('');const [busy,setBusy]=useState(false);const [revision,refresh]=useState(0);const epoch=useRef(0);
 const [thread,setThread]=useState('');const [section,setSection]=useState<string>(boot?.section||'files');const [file,setFile]=useState(boot?.file||'');const [split,setSplit]=useState(boot?.split||false);const [viewed,setViewed]=useState<Record<string,boolean>>(boot?.viewed||{});const [unresolved,setUnresolved]=useState(boot?.unresolved||false);
 const setData=(update:(old:Record<string,PrResult>)=>Record<string,PrResult>)=>setLiveData(old=>({key:detailKey,value:update(old?.key===detailKey?old.value:cachedData?.value||{})}));
 const [draftHead,setDraftHead]=useState('');const [drafts,setDrafts]=useState<Inline[]>([]);const [reviewBody,setReviewBody]=useState('');const [event,setEvent]=useState<'COMMENT'|'APPROVE'|'REQUEST_CHANGES'>('COMMENT');const [line,setLine]=useState(1);const [side,setSide]=useState<'LEFT'|'RIGHT'>('RIGHT');const [inlineBody,setInlineBody]=useState('');const [strategy,setStrategy]=useState<'merge'|'squash'|'rebase'>('squash');
 const [dialog,setDialog]=useState<{action:string;fields:Record<string,string>;extra?:Record<string,unknown>}|null>(null);
 useEffect(()=>{const timer=setTimeout(()=>setDebouncedSearch(search),300);return()=>clearTimeout(timer)},[search]);
 useEffect(()=>{let live=true;setListLoading(true);setListError('');if(search!==debouncedSearch)return()=>{live=false};cache.load(listKey,()=>api.list({state:filter==='merged'?'closed':filter as 'open'|'closed'|'all',search:(search+(filter==='merged'?' is:merged':filter==='closed'?' is:unmerged':'')).trim(),page:listPage})).then(x=>{if(live){setLiveList({key:listKey,value:x});setListLoading(false)}}).catch(e=>{if(live){setListError(String(e));setListLoading(false)}});return()=>{live=false}},[api,filter,search,debouncedSearch,revision,listPage]);
 useEffect(()=>{
  const id=++epoch.current;setFresh({key:detailKey,kinds:[]});setBusy(false);setError('');setRefreshing(!!number);
  const kinds:PrRead['kind'][]=['detail','files','threads','comments','commits','checks','metadata'];
  if(number)cache.load(detailKey,async()=>{
   const next:Record<string,PrResult>={},failed:string[]=[];
   await Promise.all(kinds.map(async kind=>{try{const x=await api.read({number,kind,page:1});next[kind]=x;if(!cachedData&&epoch.current===id)setData(d=>({...d,[kind]:x}));}catch(e){failed.push(`${kind}: ${String(e)}`);}}));
   if(failed.length)throw new PrRefreshError(next,failed);return next;
  }).then(next=>{if(epoch.current===id){setLiveData({key:detailKey,value:next});setFresh({key:detailKey,kinds});}}).catch(e=>{
   if(epoch.current!==id)return;
   if(e instanceof PrRefreshError){setData(old=>!e.data.detail?old.detail?old:e.data:old.detail?.detail?.pr.head===e.data.detail.detail?.pr.head?{...old,...e.data}:e.data);setFresh({key:detailKey,kinds:Object.keys(e.data)});}
   setError(String(e));
  }).finally(()=>{if(epoch.current===id)setRefreshing(false);});
  return()=>{epoch.current++};
 },[api,number,revision]);
 useEffect(()=>{cache.set(viewKey,{listPage,filter,search,number,section:['jobs','logs'].includes(section)?'checks':section,file,split,unresolved,viewed});},[viewKey,listPage,filter,search,number,section,file,split,unresolved,viewed]);
 useEffect(()=>{
  const resume=()=>{if(!document.hidden&&!busy)refresh(x=>x+1);};
  window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);const timer=setInterval(resume,60000);
  return()=>{window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);clearInterval(timer);};
 },[busy]);
 const detail=data.detail?.detail,p=detail?.pr;
 const storageKey=p?`gw-pr-draft:${scope}:${number}:${p.head}`:'';
 const [loadedKey,setLoadedKey]=useState('');
 const [,reviewUpdate]=useState(0);
 useEffect(()=>watchReviews((key,receipt)=>{if(key!==storageKey)return;reviewUpdate(x=>x+1);if(receipt){try{const saved=loadReview(key);setDrafts(saved?.drafts||[]);setReviewBody(saved?.body||'');setDraftHead(saved?.head||'')}catch{}}}),[storageKey]);
 const priorKeys=(()=>{try{return Object.keys(localStorage).filter(k=>k.startsWith(`gw-pr-draft:${scope}:${number}:`)&&k!==storageKey)}catch{return []}})();
 useEffect(()=>{if(!storageKey)return;try{const saved=loadReview(storageKey);setDrafts(saved?.drafts||[]);setDraftHead(saved?.head||'');setReviewBody(saved?.body||'');setEvent(saved?.event||'COMMENT')}catch{setDrafts([]);setDraftHead('');setReviewBody('')}setLoadedKey(storageKey)},[storageKey]);
 useEffect(()=>{if(storageKey&&loadedKey===storageKey)try{saveReview(storageKey,drafts.length||reviewBody?{drafts,head:draftHead,body:reviewBody,event}:null)}catch{/* In-memory drafts remain available if storage is unavailable. */}},[storageKey,loadedKey,drafts,draftHead,reviewBody,event]);
const blocked=blockers(detail,data);if(!canAct||!['checks','threads'].every(k=>freshKinds.includes(k)))blocked.unshift('Refresh current-head requirements before merging');const permissions=detail?.permissions;
 function open(action:string,fields:Record<string,string>={},extra:Record<string,unknown>={}){if(!enabled||(action!=='create'&&!canAct)){setError('Wait for the current PR to refresh before applying an action.');return;}setDialog({action,fields,extra})}
 async function send(){if(!dialog||busy)return;if(!enabled||(dialog.action!=='create'&&!canAct)){setError('Wait for the current PR to refresh before applying an action.');return;}const submittedKey=storageKey;const submitted:ReviewDraft={drafts:structuredClone(drafts),head:draftHead,body:reviewBody,event};const isReview=dialog.action==='review';if(isReview&&!reserveReview(submittedKey))return;const id=epoch.current;setBusy(true);setError('');cache.invalidate(key=>{try{const [kind,id]=JSON.parse(key);return ['pr-list','pr-detail'].includes(kind)&&id===cacheScope;}catch{return false;}});try{
 const f=dialog.fields;let op:Record<string,unknown>={...f,...dialog.extra,action:dialog.action,confirmed:true,number,expectedHead:p?.head};
 if(dialog.action==='create')op={...op,draft:f.draft==='true'};
 if(dialog.action==='metadata')for(const k of ['labels','assignees','reviewers'])if(k in f)op[k]=f[k].split(',').map(s=>s.trim()).filter(Boolean);
 if(dialog.action==='review')op={...op,event,body:reviewBody,comments:drafts,expectedHead:draftHead||p?.head};
 const result=await api.mutate(op as PrMutation);
 if(result.applied&&isReview){try{acknowledgeReview(submittedKey,submitted)}catch{/* Keep the in-memory receipt even if storage is unavailable. */}}
 if(id!==epoch.current)return;
 if(result.applied){if(dialog.action==='review'){/* Receipt listener reloads the reconciled original record. */}setDialog(null);setNotice(result.refreshError?`Applied successfully. Refresh failed: ${result.refreshError}`:'Action applied. Refreshing current head…');refresh(x=>x+1)}
 }catch(e){if(isReview)reviewDeliveryWarning(submittedKey,`${String(e)}. Delivery may be uncertain. Drafts retained; refresh and reconcile before submitting again.`);if(id===epoch.current)setError(`${String(e)}. Delivery may be uncertain after a timeout. Drafts retained; refresh and reconcile before submitting again.`)}finally{if(isReview)releaseReview(submittedKey);if(id===epoch.current)setBusy(false)}}
 async function readRun(kind:'jobs'|'logs',runId:number){const id=epoch.current;try{const x=await api.read({number,kind,page:1,runId});if(id===epoch.current){setData(d=>({...d,[kind]:x}));setSection(kind)}}catch(e){if(id===epoch.current)setError(String(e))}}
 async function more(kind:string){const next=data[kind]?.nextPage;if(!next)return;const id=epoch.current;try{const x=await api.read({number,kind:kind as PrRead['kind'],page:next});if(id===epoch.current)setData(d=>{const old=d[kind];return {...d,[kind]:{...x,coverageComplete:false,items:[...old.items,...x.items],files:kind==='files'?[...(old.files||[]),...(x.files||[])]:x.files,comments:kind==='comments'?[...(old.comments||[]),...(x.comments||[])]:x.comments,commits:kind==='commits'?[...(old.commits||[]),...(x.commits||[])]:x.commits}}})}catch(e){setError(String(e))}}
 const selected=data.files?.files?.find(x=>x.filename===file)||data.files?.files?.[0];
 function react(id:number,kind:'issue'|'review'){open('reaction',{}, {id:String(id),commentKind:kind,reaction:'+1'})}
 const health=studioHealth(detail,data);
 const meta=(detail?.data&&typeof detail.data==='object'&&!Array.isArray(detail.data)?detail.data:{}) as Record<string,any>;
 const merged=meta.merged===true;
 const prState=merged?'merged':p?.draft?'draft':p?.state||'unknown';
 const files=data.files?.files||[];
 const fileByPath=new Map(files.map(f=>[f.filename,f]));
 const added=files.reduce((n,f)=>n+f.additions,0),removed=files.reduce((n,f)=>n+f.deletions,0);
 const labels=names(meta.labels,'name'),assignees=names(meta.assignees,'login');
 const reviewers=[...names(meta.requested_reviewers,'login'),...names(meta.requested_teams,'name')];
 const openThreads=data.threads?.threads?.filter(t=>!t.isResolved)||[];
 const attention=data.checks?.checks?.checkRuns.filter(c=>!['success','neutral','skipped'].includes(c.conclusion?.toLowerCase()||''))||[];
 const confirmation=dialog?prActionStyle(dialog.action,dialog.extra,event):null;
 return <section className={`pr-workbench pr-studio${number?' pr-detail-active':''}`} aria-label="Pull requests">
  <div className="pr-toolbar pr-list-toolbar">
   <input aria-label="Search pull requests" placeholder="Search PRs…" value={search} onInput={e=>{setSearch(e.currentTarget.value);setListPage(1)}}/>
   <select aria-label="PR state" value={filter} onChange={e=>{setFilter(e.target.value);setListPage(1)}}>{['open','closed','merged','all'].map(x=><option key={x}>{x}</option>)}</select>
   <select aria-label="Select pull request" value={number} onChange={e=>{setNumber(+e.target.value);setDialog(null)}}><option value={0}>Select pull request</option>{list?.items.map(raw=>{const x=raw as {number:number;title:string};return <option key={x.number} value={x.number}>#{x.number} {x.title}</option>})}</select>
   <button className="pr-primary" onClick={()=>open('create',{title:'',body:'',base:'main',head:'',draft:'true'})}>Create PR</button>
   <button onClick={()=>refresh(x=>x+1)}>Refresh</button>
  </div>
 {(number&&p&&(refreshing||!dataFresh)||!number&&list&&(listLoading||listError))&&<div className="pr-sync-status" role="status"><span>{refreshing||listLoading?'Updating in background…':'Showing last available data · Refresh to retry'}</span>{(number?cachedData:cachedList)&&<small>Last loaded {syncTime((number?cachedData:cachedList)!.updatedAt)}</small>}</div>}
 {listError&&list&&<p className="pr-feedback" role="alert">Refresh failed: {listError}. The saved results remain available.</p>}
 {!number&&<><header className="pr-inbox-heading"><div><h2>Pull requests</h2><p>Review changes, follow checks, and choose what’s next.</p></div><small>Recently updated first</small></header>
 <div className="pr-toolbar pr-inbox-pagination"><button disabled={listLoading||listPage===1} onClick={()=>setListPage(x=>x-1)}>Previous PR page</button><span>Page {listPage} · {listLoading?'Loading…':`${list?.items.length??0} on this page`}</span><button disabled={listLoading||!list?.nextPage} onClick={()=>setListPage(list!.nextPage!)}>Next PR page</button></div>
 {!listLoading&&!listError&&list?.searchComplete===false&&<p role="status">GitHub search is incomplete. Matches may be missing; refine your search or Refresh to retry.</p>}
 {listLoading&&!list?<div className="pr-inbox-empty" role="status">Loading pull requests…</div>:listError&&!list?<div className="pr-inbox-empty" role="alert">{listError}<p>Check gh installation, GitHub authentication and repository access on the selected host, then Refresh.</p></div>:list?.items.length===0?<div className="pr-inbox-empty"><strong>{list.searchComplete===false?'Search could not establish whether pull requests match':list.coverageComplete&&!list.truncated?'No matching pull requests':'No pull requests returned on this page'}</strong><p>{list.coverageComplete&&!list.truncated?'Try another search or state filter.':'Refine your search, return to the previous page, or Refresh to retry.'}</p></div>:<PrInbox items={list?.inbox||list?.items.map(raw=>{const x=raw as {number:number;title:string};return {number:x.number,title:x.title,preview:'',state:'unknown',author:'Unknown author',branch:'Branch unavailable',base:'unknown',labels:[],labelsTruncated:false,updatedAt:'',ci:'Unavailable',review:'Unavailable',healthAvailable:false}})||[]} onSelect={n=>{setNumber(n);setDialog(null)}}/>}
 {list?.nextPage&&<small>More results are available on the next page.</small>}</>}

  {error&&<p className="pr-feedback" role="alert">{error} Check gh installation, GitHub authentication and repository access on the selected host, then Refresh.</p>}
  {notice&&<p className="pr-feedback" role="status">{notice}</p>}
  {p&&<>
   <header className="pr-identity">
    <div className="pr-eyebrow"><span>Pull requests / #{p.number}</span><span className="pr-state-badge" data-tone={merged?'review':p.draft?'neutral':p.state==='open'?'good':'bad'}>{humanize(prState)}</span>{labels.slice(0,3).map(l=><span className="pr-label" key={l}>{l}</span>)}</div>
    <div className="pr-title-row"><h2>{p.title}</h2><button className="pr-back" onClick={()=>{setNumber(0);setDialog(null)}}>← Back to pull requests</button></div>
    <div className="pr-meta"><span className="pr-avatar" aria-hidden="true">{p.author.slice(0,2).toUpperCase()}</span><span>{p.author}</span><span aria-hidden="true">·</span><code title={p.branch}>{p.branch}</code><span>→</span><code>{p.base}</code><span aria-hidden="true">·</span><span title={p.head}>{p.head.slice(0,12)}</span><a href={p.url} target="_blank" rel="noreferrer">Open on GitHub ↗</a></div>
   </header>
   <div className="pr-health-strip" aria-label="Pull request health">
    {health.slice(0,3).map(item=><button className="pr-status-pill" data-tone={item.tone} key={item.section} title={item.detail} onClick={()=>setSection(item.section)}><span aria-hidden="true">{item.symbol}</span>{item.label}</button>)}
    <span className="pr-file-totals">{data.files?`${files.length} files${data.files.coverageComplete?'':' loaded'}`:'Loading files…'}<span className="pr-added">+{added}</span><span className="pr-removed">−{removed}</span></span>
   </div>
   <details className="pr-description pr-panel" key={`${number}:${p.head}`}><summary>About this change <span>Description & context</span></summary><div className="pr-description-body">{p.body?<Markdown className="pr-markdown" content={p.body}/>:<p>No description provided.</p>}</div></details>
   <div className="pr-canvas pr-studio-grid">
    <aside className="pr-files pr-panel" aria-label="Changed files">
     <div className="pr-panel-title"><strong>Changed files</strong><span>{data.files?`${files.length}${data.files.coverageComplete?'':'+'}`:'…'}</span></div>
     {!data.files?<p role="status" className="pr-muted-note">Loading changed files…</p>:!files.length?<p className="pr-muted-note">{data.files.coverageComplete?'No changed files':'Files unavailable; coverage is incomplete'}</p>:<FileTree paths={files.map(f=>f.filename)} selected={selected?.filename||''} onSelect={path=>{setFile(path);setSection('files')}} viewed={path=>!!viewed[p.head+path]} suffix={path=>{const f=fileByPath.get(path)!;return <><span className="pr-added">+{f.additions}</span><span className="pr-removed">−{f.deletions}</span></>}}/>}
     {data.files&&!data.files.coverageComplete&&<p className="pr-muted-note">File coverage is incomplete.</p>}
     {data.files?.nextPage&&<button className="pr-load-more" onClick={()=>void more('files')}>Load more files</button>}
    </aside>
    <main className="pr-context pr-panel" aria-label="Review detail">
     <nav className="pr-section-tabs" aria-label="Review sections">{['files','threads','comments','commits','checks','review'].map(x=><button key={x} aria-pressed={section===x} onClick={()=>setSection(x)}>{x}</button>)}</nav>
     <div className="pr-content-body">
      {data[section]&&!data[section].coverageComplete&&<p className="pr-coverage-note">Incomplete coverage. Unseen items may remain.</p>}
      {section!=='files'&&data[section]?.nextPage&&<button onClick={()=>void more(section)}>Load more</button>}
      {section==='files'&&selected&&<>
       <div className="pr-file-toolbar"><div className="pr-file-path"><strong title={selected.filename}>{selected.filename}</strong>{selected.previous_filename&&<small>Renamed from {selected.previous_filename}</small>}</div><span className="pr-file-delta"><span className="pr-added">+{selected.additions}</span><span className="pr-removed">−{selected.deletions}</span></span><div className="pr-file-tools"><button onClick={()=>setSplit(!split)}>{split?'Unified':'Split'} diff</button><label><input type="checkbox" checked={!!viewed[p.head+selected.filename]} onChange={e=>setViewed({...viewed,[p.head+selected.filename]:e.target.checked})}/>Viewed locally</label></div></div>
       {selected.patch?<PatchDiff patch={selected.patch} split={split}/>:<p className="pr-muted-note">Patch unavailable: binary, deleted or too large. <a href={selected.blob_url}>View file on GitHub</a></p>}
       <div className="pr-file-discussions">{openThreads.filter(t=>t.path===selected.filename).slice(0,2).map(t=><button key={t.id} className="pr-thread-preview" onClick={()=>{setSection('threads');setThread(t.id)}}><span className="pr-thread-heading"><span className="pr-avatar" aria-hidden="true">{(t.comments.nodes[0]?.author?.login||'?').slice(0,2).toUpperCase()}</span><strong>Unresolved · line {t.line??'outdated'}</strong></span><span>{t.comments.nodes[0]?.body||'Review discussion'}</span><small>View discussion →</small></button>)}</div>
       <details className="pr-inline-composer"><summary>Add inline comment</summary><div><div className="pr-toolbar"><label>Line<input aria-label="Inline line" type="number" min="1" value={line} onChange={e=>setLine(+e.target.value)}/></label><label>Side<select aria-label="Inline side" value={side} onChange={e=>setSide(e.target.value as typeof side)}><option>RIGHT</option><option>LEFT</option></select></label><button onClick={()=>setInlineBody('```suggestion\n\n```')}>Suggestion</button></div><textarea aria-label="Inline comment" value={inlineBody} onChange={e=>setInlineBody(e.target.value)} placeholder="Draft an inline comment…"/><div className="pr-toolbar"><button className="pr-primary" disabled={!selected.patch||!inlineBody||line<1||!!draftHead&&draftHead!==p.head} onClick={()=>{setDraftHead(draftHead||p.head);setDrafts([...drafts,{path:selected.filename,line,side,body:inlineBody}]);setInlineBody('');setSection('review')}}>Add to review</button><small>Choose a real changed line and side.</small></div></div></details>
      </>}
      {section==='files'&&!data.files&&<p role="status" className="pr-muted-note">Loading diff…</p>}
      {section==='files'&&data.files&&!selected&&<p className="pr-muted-note">Select a changed file to view its diff.</p>}
 {section==='threads'&&<><button onClick={()=>setThread('')}>All discussions</button><label><input type="checkbox" checked={unresolved} onChange={e=>setUnresolved(e.target.checked)}/>Unresolved only</label>{data.threads?.threads?.filter(t=>(!unresolved||!t.isResolved)&&(!thread||thread===t.id)).map(t=><article key={t.id}><strong>{t.path}:{t.line} · {t.diffSide} {t.isOutdated?'outdated':''} {t.isResolved?'resolved':''}</strong>{t.comments.nodes.map(c=><div key={c.id}><small>{c.author?.login}</small><Markdown className="pr-markdown" content={c.body}/>{c.databaseId&&<><button onClick={()=>open('reply',{body:''},{id:String(c.databaseId)})}>Reply</button><button onClick={()=>react(c.databaseId!,'review')}>React</button></>}</div>)}<button disabled={t.isResolved?!t.viewerCanUnresolve:!t.viewerCanResolve} onClick={()=>open('resolve',{}, {id:t.id,resolved:!t.isResolved})}>{t.isResolved?'Unresolve':'Resolve'}</button></article>)}</>}
 {section==='comments'&&<><button onClick={()=>open('comment',{body:''})}>Add comment</button>{data.comments?.comments?.map(c=><article key={c.id}><small>{c.user?.login}</small><Markdown className="pr-markdown" content={c.body}/><a href={c.html_url}>Open comment</a><button onClick={()=>react(c.id,'issue')}>React</button></article>)}</>}
 {section==='commits'&&data.commits?.commits?.map(c=><article key={c.sha}><a href={c.html_url}>{c.sha.slice(0,12)}</a><pre>{c.commit.message}</pre><small>{c.commit.author?.name} · {c.commit.author?.date}</small></article>)}
 {section==='checks'&&<Checks result={data.checks} head={p.head} canAct={canAct&&freshKinds.includes('checks')} onReadRun={(kind,id)=>void readRun(kind,id)} onAction={(action,id)=>open(action,{}, {runId:id})}/>}
 {['jobs','logs'].includes(section)&&<div className="pr-panel-title"><strong>{section==='jobs'?'Run jobs':'Failed run logs'}</strong><button onClick={()=>setSection('checks')}>Back to checks</button></div>}
 {section==='jobs'&&data.jobs?.items.map((j,i)=><article key={i}><strong>{(j as any).name}</strong><small> · {(j as any).conclusion||(j as any).status}</small>{((j as any).steps||[]).map((step:any)=><p key={step.number}>{step.name} · {step.conclusion||step.status}</p>)}</article>)}{section==='logs'&&<><pre>{data.logs?.text}</pre>{data.logs?.truncated&&<p>Logs truncated.</p>}</>}
 {section==='review'&&<>{reviewDeliveryWarning(storageKey)&&<p role="alert">{reviewDeliveryWarning(storageKey)}</p>}{reviewPending(storageKey)&&<p role="status">Review delivery pending. This batch cannot be submitted again while awaiting its receipt.</p>}{priorKeys.map(k=><details key={k}><summary>Saved drafts on prior head {k.slice(-40,-28)}</summary><pre>{(()=>{try{return JSON.stringify(JSON.parse(localStorage.getItem(k)||'{}'),null,2)}catch{return 'Unavailable'}})()}</pre><small>These drafts stay on the prior revision. Reconcile them against the current diff before creating a new review.</small></details>)}<p>{drafts.length} local inline drafts · pinned to {(draftHead||p.head).slice(0,12)}{draftHead&&draftHead!==p.head?' · HEAD CHANGED: remove old drafts before reviewing the new revision':''}</p>{drafts.map((d,i)=><article key={i}>{d.path}:{d.line} {d.side}<pre>{d.body}</pre><button onClick={()=>setDrafts(drafts.filter((_,n)=>n!==i))}>Remove draft</button></article>)}<textarea aria-label="Review body" value={reviewBody} onChange={e=>{setDraftHead(draftHead||p.head);setReviewBody(e.target.value)}}/><select aria-label="Review event" value={event} onChange={e=>setEvent(e.target.value as typeof event)}><option>COMMENT</option><option disabled={permissions?.pullRequest.viewerDidAuthor}>APPROVE</option><option disabled={permissions?.pullRequest.viewerDidAuthor}>REQUEST_CHANGES</option></select><button disabled={reviewPending(storageKey)||(event==='COMMENT'&&!reviewBody&&!drafts.length)||!!draftHead&&draftHead!==p.head||event!=='COMMENT'&&permissions?.pullRequest.viewerDidAuthor} onClick={()=>open('review')}>Submit review…</button></>}

     </div>
    </main>
    <aside className="pr-inspector" aria-label="Review readiness">
     <section className="pr-panel">
      <div className="pr-panel-title"><strong>Readiness</strong><span>{canAct?'Current head':'Saved view'}</span></div>
      <div className="pr-status-list">{health.map(item=><button className="pr-status-item" key={item.section} data-tone={item.tone} onClick={()=>setSection(item.section)}><span className="pr-status-icon" aria-hidden="true">{item.symbol}</span><span><strong>{item.label}</strong><small>{item.detail}</small></span></button>)}</div>
      <div className="pr-inspector-actions"><button className="pr-primary" onClick={()=>setSection('review')}>Prepare review →</button><button className="pr-secondary" onClick={()=>setSection('checks')}>Inspect CI and runs →</button></div>
      <details className="pr-blocker-list" open={p.state==='open'&&blocked.length>0}><summary>Merge blockers <span>{blocked.length}</span></summary><div>{blocked.length?<ul>{blocked.map(x=><li key={x}>{x}</li>)}</ul>:<p className="pr-muted-note">Current requirements satisfied</p>}</div></details>
      {attention.length>0&&<details className="pr-attention"><summary>Checks needing attention <span>{attention.length}</span></summary><div>{attention.slice(0,3).map(c=><button key={c.id} onClick={()=>setSection('checks')}>{c.name} · {c.conclusion||c.status}</button>)}{attention.length>3&&<small>Inspect CI for all {attention.length} checks.</small>}</div></details>}
      {openThreads.length>0&&<details className="pr-attention"><summary>Unresolved discussions <span>{openThreads.length}</span></summary><div>{openThreads.slice(0,3).map(t=><button key={t.id} onClick={()=>{setSection('threads');setThread(t.id)}}>{t.path}:{t.line} · {t.comments.nodes[0]?.body.slice(0,80)}</button>)}{openThreads.length>3&&<button onClick={()=>setSection('threads')}>View all discussions</button>}</div></details>}
     </section>
     <section className="pr-panel pr-people"><div className="pr-panel-title"><strong>People & labels</strong></div><div className="pr-people-body"><small>Author</small><div className="pr-person"><span className="pr-avatar" aria-hidden="true">{p.author.slice(0,2).toUpperCase()}</span>{p.author}</div><small>Reviewers</small>{reviewers.length?reviewers.map(r=><div className="pr-person" key={r}><span className="pr-avatar" aria-hidden="true">{r.slice(0,2).toUpperCase()}</span>{r}</div>):<span className="pr-muted">{Array.isArray(meta.requested_reviewers)?'No reviewers requested':'Reviewers not reported'}</span>}{permissions?.pullRequest.reviewRequests.pageInfo.hasNextPage&&<small>More review requests on GitHub.</small>}<button className="pr-text-action" onClick={()=>open('metadata',{reviewers:''})}>Request review…</button>{assignees.length>0&&<><small>Assignees</small><span>{assignees.join(', ')}</span></>}<small>Labels</small><div className="pr-labels">{labels.length?labels.map(l=><span className="pr-label" key={l}>{l}</span>):<span className="pr-muted">{Array.isArray(meta.labels)?'No labels':'Labels not reported'}</span>}</div></div>
      <details className="pr-management"><summary>Manage pull request…</summary><div className="pr-toolbar"><button onClick={()=>open('edit',{title:p.title,body:p.body})}>Edit</button><button onClick={()=>open('metadata',{reviewers:''})}>Request reviewers</button><button onClick={()=>open('metadata',{reviewers:''},{remove:true})}>Remove reviewers</button><button onClick={()=>open('metadata',{labels:labels.join(','),assignees:assignees.join(',')})}>Labels / assignees</button><button onClick={()=>open('draft',{}, {draft:!p.draft})}>{p.draft?'Mark ready':'Mark draft'}</button><button disabled={p.state==='open'?!permissions?.pullRequest.viewerCanClose:!permissions?.pullRequest.viewerCanReopen} onClick={()=>open('state',{}, {state:p.state==='open'?'closed':'open'})}>{p.state==='open'?'Close PR':'Reopen PR'}</button><button onClick={()=>open('checkout')}>Checkout PR</button><button onClick={()=>open('worktree',{path:''})}>Review worktree</button></div></details>
     </section>
    </aside>
   </div>
   <footer className="pr-toolbar pr-merge"><small>{merged?`Merged into ${p.base}`:blocked.length?`${blocked.length} blockers · GitHub rules apply`:'Ready for guarded merge'}</small><div className="pr-merge-actions"><button onClick={()=>setSection('review')}>Prepare review</button><details className="pr-auto-merge"><summary>Auto-merge</summary><div><button disabled={!permissions?.pullRequest.viewerCanEnableAutoMerge||p.draft||p.state!=='open'} onClick={()=>open('auto-merge',{}, {strategy})}>Enable auto-merge…</button><button disabled={!permissions?.pullRequest.viewerCanDisableAutoMerge} onClick={()=>open('disable-auto-merge')}>Disable auto-merge…</button></div></details><select aria-label="Merge strategy" value={strategy} onChange={e=>setStrategy(e.target.value as typeof strategy)}>{(['squash','merge','rebase'] as const).map(x=><option key={x} disabled={!permissions?.[x==='merge'?'mergeCommitAllowed':x==='squash'?'squashMergeAllowed':'rebaseMergeAllowed']}>{x}</option>)}</select><button className="pr-primary" disabled={!!blocked.length||!permissions?.[strategy==='merge'?'mergeCommitAllowed':strategy==='squash'?'squashMergeAllowed':'rebaseMergeAllowed']} onClick={()=>open('merge',{}, {strategy})}>Merge…</button></div></footer>
  </>}
  {!!number&&!p&&!error&&<p role="status" className="pr-muted-note">Loading PR details…</p>}
 {dialog&&<div className="gw-overlay"><form className={`gw-dialog pr-action-dialog pr-confirm-${confirmation!.tone}`} role="dialog" aria-modal="true" aria-label={`Confirm ${dialog.action}`} onSubmit={e=>{e.preventDefault();void send()}}><header className="pr-dialog-heading"><span className="pr-dialog-icon" aria-hidden="true">{confirmation!.tone==='danger'?'!':dialog.action==='merge'?'⑂':confirmation!.tone==='review'?'◉':'✓'}</span><div><small>Pull request action</small><h3>{confirmation!.label}</h3></div></header><p className="pr-dialog-context">{dialog.action==='create'?'Uses an already published source branch. This does not push.':<><span>PR #{number}</span><code>head {p?.head.slice(0,12)}</code>{typeof dialog.extra?.strategy==='string'&&<span>{String(dialog.extra.strategy)}</span>}</>}</p>{Object.entries(dialog.fields).map(([k,v])=><label key={k}>{humanize(k)}{k==='body'?<textarea value={v} onChange={e=>setDialog({...dialog,fields:{...dialog.fields,[k]:e.target.value}})}/>:k==='draft'?<select value={v} onChange={e=>setDialog({...dialog,fields:{...dialog.fields,[k]:e.target.value}})}><option value="true">Draft</option><option value="false">Ready for review</option></select>:<input required={!['labels','assignees'].includes(k)} value={v} placeholder={k==='path'?'/absolute/path/to/review-worktree':k==='reviewers'?'login, another-login':k} onChange={e=>setDialog({...dialog,fields:{...dialog.fields,[k]:e.target.value}})}/>}</label>)}{dialog.action==='reaction'&&<><select aria-label="Reaction" onChange={e=>setDialog({...dialog,extra:{...dialog.extra,reaction:e.target.value}})}>{['+1','-1','laugh','confused','heart','hooray','rocket','eyes'].map(x=><option key={x}>{x}</option>)}</select><label><input type="checkbox" onChange={e=>setDialog({...dialog,extra:{...dialog.extra,remove:e.target.checked}})}/>Remove my reaction</label></>}{dialog.action==='metadata'&&<small>Comma separated logins/names. Replaces labels/assignees; reviewers are requested or removed explicitly. Candidate metadata may be incomplete: {data.metadata?.items.map((group:any,i:number)=><span key={i}>{Object.entries(group).map(([kind,entries]:any)=><span key={kind}> {kind}: {Array.isArray(entries)?entries.map((x:any)=>x.name||x.login).join(', '):'unavailable'}. </span>)}</span>)}</small>}<div className="gw-dialog-actions"><button className="gw-secondary" type="button" disabled={busy} onClick={()=>setDialog(null)}>Cancel</button><button type="submit" className="pr-primary" disabled={busy||!enabled||dialog.action!=='create'&&!canAct}>{busy?'Applying…':confirmation!.label}</button></div></form></div>}
 </section>
}

export function checkSummary(result?:PrResult){const checks=result?.checks;const states=[...(checks?.checkRuns||[]).map(c=>(c.conclusion||c.status).toLowerCase()),...(checks?.statuses||[]).map(c=>c.state.toLowerCase())];return `${states.filter(s=>s==='success').length} passed · ${states.filter(s=>['failure','error','timed_out','cancelled','action_required'].includes(s)).length} failing · ${states.filter(s=>['pending','queued','in_progress','waiting','requested'].includes(s)).length} pending · ${states.filter(s=>['neutral','skipped'].includes(s)).length} neutral/skipped · ${checks?.requiredCoverage||'unknown'} coverage`;}
