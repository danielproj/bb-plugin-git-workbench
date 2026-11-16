import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {act} from 'react';
import {installTestPluginRuntime} from '@get-bb/plugin-sdk/testing/app';
import {PullRequests,type PrApi} from './pull-requests';
import {prResult,type PrRead,type PrResult} from './pr-contract';
installTestPluginRuntime();
const head='a'.repeat(40),nextHead='b'.repeat(40);
const empty:PrResult={items:[],coverageComplete:true,nextPage:null,text:'',truncated:false};
function response(kind:PrRead['kind'],sha=head,title='Remember this PR'):PrResult{
 if(kind==='detail')return prResult.parse({...empty,detail:{pr:{number:1,title,body:'Context',state:'open',url:'https://github.com/o/r/pull/1',draft:false,head:sha,base:'main',branch:'feature',author:'author',mergeable:true,mergeState:'clean'},data:{labels:[],requested_reviewers:[]},permissions:{viewerPermission:'WRITE',mergeCommitAllowed:true,squashMergeAllowed:true,rebaseMergeAllowed:true,pullRequest:{id:'P_1',viewerDidAuthor:false,viewerCanClose:true,viewerCanReopen:false,viewerCanEnableAutoMerge:true,viewerCanDisableAutoMerge:false,reviewDecision:'APPROVED',mergeStateStatus:'CLEAN',autoMergeRequest:null,reviewRequests:{nodes:[],pageInfo:{hasNextPage:false}}}}}});
 if(kind==='checks')return {...empty,checks:{head:sha,requiredCoverage:'complete',contexts:[],statuses:[],checkRuns:[{id:1,name:'Tests',status:'completed',conclusion:'success',details_url:'https://github.com/o/r/actions/runs/1/job/2',output:{title:null,summary:null,text:null}}]}};
 if(kind==='files')return {...empty,files:[{filename:'src/a.ts',status:'modified',additions:1,deletions:1,patch:'@@ -1 +1 @@\n-old\n+new'}]};
 return {...empty,threads:[],comments:[]};
}
function dom(){const d=new JSDOM('<div id="app"></div>',{url:'http://localhost'});Object.assign(globalThis,{window:d.window,document:d.window.document,HTMLElement:d.window.HTMLElement,localStorage:d.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true});return d;}
test('reopening a PR restores its view immediately, refreshes atomically, and never trusts cached merge readiness',async()=>{
 const d=dom(),{createRoot}=await import('react-dom/client'),box=document.getElementById('app')!;let root=createRoot(box),mode='live',writes=0;
 const pending=new Map<string,(result:PrResult)=>void>();
 const api:PrApi={list:async()=>mode==='hold'?new Promise(r=>pending.set('list',r)):{...empty,items:[{number:1,title:'Remember this PR'}]},read:async r=>mode==='hold'?new Promise(resolve=>pending.set(r.kind,resolve)):response(r.kind),mutate:async()=>{writes++;return {...empty,applied:true};}};
 const click=async(text:string)=>act(async()=>{const b=[...box.querySelectorAll('button')].find(e=>e.textContent===text);assert.ok(b,text);b.click();});
 try{
  await act(async()=>root.render(<PullRequests api={api} scope="scope:a"/>));
  await act(async()=>{const s=box.querySelector('[aria-label="Select pull request"]') as HTMLSelectElement;s.value='1';s.dispatchEvent(new d.window.Event('change',{bubbles:true}));});
  await click('checks');assert.match(box.textContent!,/Checks & workflows/);assert.equal((box.querySelector('.pr-merge .pr-primary') as HTMLButtonElement).disabled,false);
  await act(async()=>root.unmount());mode='hold';root=createRoot(box);
  await act(async()=>root.render(<PullRequests api={api} scope="scope:a"/>));
  assert.equal(box.querySelector('.pr-title-row h2')?.textContent,'Remember this PR');assert.match(box.textContent!,/Checks & workflows/);assert.doesNotMatch(box.textContent!,/Loading PR details/);assert.match(box.textContent!,/Updating in background/);
  assert.equal((box.querySelector('.pr-merge .pr-primary') as HTMLButtonElement).disabled,true);
  await click('Prepare review →');assert.equal(writes,0);
  await act(async()=>pending.get('detail')!(response('detail',nextHead,'Fresh PR title')));
  assert.equal(box.querySelector('.pr-title-row h2')?.textContent,'Remember this PR','cached coherent view remains until refresh finishes');
  await act(async()=>{for(const [kind,resolve] of pending)if(kind!=='detail')resolve(kind==='list'?{...empty,items:[{number:1,title:'Fresh PR title'}]}:response(kind as PrRead['kind'],nextHead));});
  assert.equal(box.querySelector('.pr-title-row h2')?.textContent,'Fresh PR title');assert.equal((box.querySelector('.pr-merge .pr-primary') as HTMLButtonElement).disabled,false);assert.equal(writes,0);
 }finally{await act(async()=>root.unmount());d.window.close();}
});
test('failed background refresh keeps saved content; changed scope cannot inherit another repository PR',async()=>{
 const d=dom(),{createRoot}=await import('react-dom/client'),box=document.getElementById('app')!;let root=createRoot(box),offline=false;
 const api:PrApi={list:async()=>{if(offline)throw Error('offline list');return {...empty,items:[{number:1,title:'Saved data'}]};},read:async r=>{if(offline)throw Error('offline detail');return response(r.kind);},mutate:async()=>{throw Error('No writes');}};
 try{
  await act(async()=>root.render(<PullRequests api={api} scope="repo:a:/linked"/>));
  await act(async()=>{const s=box.querySelector('[aria-label="Select pull request"]') as HTMLSelectElement;s.value='1';s.dispatchEvent(new d.window.Event('change',{bubbles:true}));});
  await act(async()=>root.unmount());offline=true;root=createRoot(box);await act(async()=>root.render(<PullRequests api={api} scope="repo:a:/linked"/>));
  assert.equal(box.querySelector('.pr-title-row h2')?.textContent,'Remember this PR');assert.match(box.textContent!,/offline detail/);assert.equal((box.querySelector('.pr-merge .pr-primary') as HTMLButtonElement).disabled,true);
  await act(async()=> ([...box.querySelectorAll('button')].find(b=>b.textContent==='← Back to pull requests')!).click());assert.ok(box.querySelector('.pr-inbox-row'));assert.match(box.textContent!,/saved results remain available/);
  await act(async()=>root.render(<PullRequests key="other" api={api} scope="repo:b:/linked"/>));assert.equal(box.querySelector('.pr-title-row'),null);assert.equal(box.querySelector('.pr-inbox-row'),null);assert.match(box.textContent!,/offline list/);
 }finally{await act(async()=>root.unmount());d.window.close();}
});
test('merge confirmation identifies the selected strategy, cancellation writes nothing, and submission stays head-pinned',async()=>{
 const d=dom(),{createRoot}=await import('react-dom/client'),box=document.getElementById('app')!,root=createRoot(box),writes:any[]=[];
 const api:PrApi={list:async()=>({...empty,items:[{number:1,title:'Merge sample'}]}),read:async r=>response(r.kind),mutate:async op=>{writes.push(op);return {...empty,applied:true};}};
 const click=async(text:string)=>act(async()=>{const b=[...box.querySelectorAll('button')].find(e=>e.textContent===text);assert.ok(b,text);b.click();});
 try{
  await act(async()=>root.render(<PullRequests api={api} scope="merge-confirmation"/>));
  await act(async()=>{const s=box.querySelector('[aria-label="Select pull request"]') as HTMLSelectElement;s.value='1';s.dispatchEvent(new d.window.Event('change',{bubbles:true}));});
  await click('Merge…');assert.equal(box.querySelector('.pr-dialog-heading h3')?.textContent,'Squash and merge');assert.equal(box.querySelector('.gw-dialog-actions button[type=submit]')?.textContent,'Squash and merge');assert.equal(writes.length,0);
  await click('Cancel');assert.equal(box.querySelector('[role=dialog]'),null);assert.equal(writes.length,0);
  await click('Merge…');await act(async()=>box.querySelector('form')!.dispatchEvent(new d.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(writes.length,1);assert.equal(writes[0].action,'merge');assert.equal(writes[0].strategy,'squash');assert.equal(writes[0].expectedHead,head);assert.equal(writes[0].confirmed,true);
 }finally{await act(async()=>root.unmount());d.window.close();}
});
test('a failed detail refresh cannot mix a cached PR header with files from another head',async()=>{
 const d=dom(),{createRoot}=await import('react-dom/client'),box=document.getElementById('app')!;let root=createRoot(box),partial=false;
 const api:PrApi={list:async()=>({...empty,items:[{number:1,title:'Saved PR'}]}),read:async r=>{
  if(partial&&r.kind==='detail')throw Error('detail unavailable');
  if(partial&&r.kind==='files')return {...empty,files:[{filename:'NEW-HEAD-ONLY.ts',status:'added',additions:5,deletions:0,patch:'@@ -0,0 +1 @@\n+new'}]};
  return response(r.kind,partial?nextHead:head);
 },mutate:async()=>{throw Error('No writes');}};
 try{
  await act(async()=>root.render(<PullRequests api={api} scope="partial-refresh"/>));
  await act(async()=>{const s=box.querySelector('[aria-label="Select pull request"]') as HTMLSelectElement;s.value='1';s.dispatchEvent(new d.window.Event('change',{bubbles:true}));});
  assert.match(box.textContent!,/src\/a.ts/);await act(async()=>root.unmount());partial=true;root=createRoot(box);await act(async()=>root.render(<PullRequests api={api} scope="partial-refresh"/>));
  assert.match(box.textContent!,/src\/a.ts/);assert.doesNotMatch(box.textContent!,/NEW-HEAD-ONLY/);assert.match(box.textContent!,/detail unavailable/);assert.equal((box.querySelector('.pr-merge .pr-primary') as HTMLButtonElement).disabled,true);
 }finally{await act(async()=>root.unmount());d.window.close();}
});
