import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {act} from 'react';
import {installTestPluginRuntime} from '@get-bb/plugin-sdk/testing/app';
import {PullRequests, PatchDiff, splitPatch, blockers, studioHealth, type PrApi} from './pull-requests';
import type {PrResult} from './pr-contract';
const sha='a'.repeat(40);
const result:PrResult={items:[],coverageComplete:true,nextPage:null,text:'',truncated:false};
installTestPluginRuntime();
const detail:any={pr:{number:1,title:'Fix regression',body:'Description',state:'open',url:'https://github.com/a/b/pull/1',draft:false,head:sha,base:'main',branch:'fix',author:'author',mergeable:true,mergeState:'clean'},data:{},permissions:{viewerPermission:'WRITE',mergeCommitAllowed:true,squashMergeAllowed:true,rebaseMergeAllowed:true,pullRequest:{viewerDidAuthor:false,viewerCanClose:true,viewerCanReopen:true,viewerCanEnableAutoMerge:true,viewerCanDisableAutoMerge:false,reviewDecision:'APPROVED',reviewRequests:{nodes:[],pageInfo:{hasNextPage:false}}}}};
test('merge readiness refuses incomplete, pending required, stale and unresolved data',()=>{
 const data:Record<string,PrResult>={checks:{...result,checks:{head:sha,requiredCoverage:'complete',checkRuns:[],statuses:[],contexts:[]}},threads:{...result,threads:[]}};
 assert.deepEqual(blockers(detail,data),[]);
 assert.ok(blockers(detail,{...data,threads:{...data.threads,coverageComplete:false}}).length);
 assert.ok(blockers(detail,{...data,checks:{...data.checks,checks:{...data.checks.checks!,head:'b'.repeat(40)}}}).length);
 data.checks.checks!.contexts=[{__typename:'CheckRun',name:'required',status:'IN_PROGRESS',isRequired:true}];
 assert.match(blockers(detail,data).join(),/Required/);
 data.checks.checks!.contexts[0].isRequired=false;
 assert.deepEqual(blockers(detail,data),[]);
 assert.ok(blockers({...detail,pr:{...detail.pr,draft:true}},data).length);
});
test('studio status colors distinguish incomplete, stale, skipped, failing and pending checks',()=>{
 const checks={...result,checks:{head:sha,requiredCoverage:'complete' as const,checkRuns:[],statuses:[{id:1,context:'CI',state:'success',description:null,target_url:null}],contexts:[]}};
 const data:Record<string,PrResult>={checks,threads:{...result,threads:[]}};
 assert.equal(studioHealth(detail,data)[0].tone,'good');
 assert.equal(studioHealth(detail,{...data,checks:{...checks,coverageComplete:false}})[0].tone,'neutral');
 assert.equal(studioHealth(detail,{...data,checks:{...checks,checks:{...checks.checks,head:'b'.repeat(40)}}})[0].tone,'neutral');
 assert.equal(studioHealth(detail,{...data,checks:{...checks,checks:{...checks.checks,statuses:[]}}})[0].label,'No checks reported');
 assert.equal(studioHealth(detail,{...data,checks:{...checks,checks:{...checks.checks,statuses:[{...checks.checks.statuses[0],state:'skipped'}]}}})[0].tone,'neutral');
 assert.equal(studioHealth(detail,{...data,checks:{...checks,checks:{...checks.checks,statuses:[{...checks.checks.statuses[0],state:'failure'}]}}})[0].tone,'bad');
 assert.equal(studioHealth(detail,{...data,checks:{...checks,checks:{...checks.checks,contexts:[{__typename:'CheckRun',name:'required',status:'IN_PROGRESS',isRequired:true}]}}})[0].tone,'warn');
 assert.equal(studioHealth(detail,{...data,threads:{...result,coverageComplete:false,threads:[]}})[2].tone,'neutral');
 assert.equal(studioHealth({...detail,permissions:{...detail.permissions,pullRequest:{...detail.permissions.pullRequest,reviewDecision:null}}},data)[1].tone,'neutral');
 const merged={...detail,pr:{...detail.pr,state:'closed',mergeState:'unknown',mergeable:null},data:{merged:true}};
 assert.equal(studioHealth(merged,data)[3].label,'Merged into main');
 assert.equal(studioHealth(merged,data)[3].tone,'review');
 assert.ok(blockers(merged,data).includes('Pull request is not open'));
});
test('studio keeps shared full-path file selection, viewed state, split diff and confirmed actions in their panes',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true});
 const {createRoot}=await import('react-dom/client');const box=document.getElementById('app')!,root=createRoot(box);let writes=0;
 const paths=['src/components/index.ts','src/hooks/index.ts'];
 const fileData={...result,files:paths.map(filename=>({filename,status:'modified',additions:1,deletions:1,patch:'@@ -1 +1 @@\n-old\n+new'}))};
 const api:PrApi={list:async()=>({...result,items:[{number:1,title:'Fix regression'}]}),read:async r=>r.kind==='detail'?{...result,detail:{...detail,data:{labels:[{name:'maintenance'}],requested_reviewers:[{login:'reviewer'}],assignees:[]}}}:r.kind==='files'?fileData:r.kind==='checks'?{...result,checks:{head:sha,requiredCoverage:'unknown',checkRuns:[],statuses:[],contexts:[]}}:{...result,threads:[],comments:[]},mutate:async()=>{writes++;return {...result,applied:true}}};
 const click=async(text:string)=>act(async()=>{const b=[...box.querySelectorAll('button')].find(x=>x.textContent===text);assert.ok(b,text);b.click()});
 try{
  await act(async()=>root.render(<PullRequests api={api} scope="studio-pane"/>));
  await act(async()=>{const e=box.querySelector('[aria-label="Select pull request"]') as HTMLSelectElement;e.value='1';e.dispatchEvent(new dom.window.Event('change',{bubbles:true}))});
  assert.deepEqual([...box.querySelector('.pr-studio-grid')!.children].map(e=>e.getAttribute('aria-label')),['Changed files','Review detail','Review readiness']);
  assert.equal((box.querySelector('.pr-description') as HTMLDetailsElement).open,false);
  assert.match(box.querySelector('.pr-files button[aria-pressed=true]')!.getAttribute('title')!,/components\/index.ts/);
  await act(async()=> (box.querySelector(`.pr-files button[title="${paths[1]}"]`) as HTMLButtonElement).click());
  assert.equal(box.querySelector('.pr-file-path strong')!.textContent,paths[1]);
  await act(async()=> (box.querySelector('.pr-file-tools input[type=checkbox]') as HTMLInputElement).click());
  assert.match(box.querySelector(`.pr-files button[title="${paths[1]}"]`)!.textContent!,/✓/);
  await click('Split diff');assert.ok(box.querySelector('.pr-diff.split'));
  assert.equal((box.querySelector('.pr-merge button.pr-primary') as HTMLButtonElement).disabled,true);
  assert.match(box.querySelector('.pr-status-pill')!.textContent!,/Checks incomplete/);
  await click('Prepare review →');assert.ok(box.querySelector('main[aria-label="Review detail"] textarea[aria-label="Review body"]'));
  await click('Checkout PR');assert.ok(box.querySelector('[role=dialog][aria-label="Confirm checkout"]'));assert.equal(writes,0);
  await click('Cancel');assert.equal(box.querySelector('[role=dialog]'),null);assert.equal(writes,0);
 }finally{await act(async()=>root.unmount());dom.window.close()}
});
test('failed comment preserves dialog text and successful acknowledgement clears it despite refresh failure',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const {createRoot}=await import('react-dom/client');const container=document.getElementById('app')!;const root=createRoot(container);let fail=true;const ops:any[]=[];
 const api:PrApi={list:async()=>({...result,items:[{number:1,title:'Fix regression'}]}),read:async r=>r.kind==='detail'?{...result,detail}:r.kind==='checks'?{...result,checks:{head:sha,requiredCoverage:'complete',checkRuns:[],statuses:[],contexts:[]}}:{...result,threads:[],comments:[]},mutate:async op=>{ops.push(op);if(fail)throw Error('timeout');return {...result,applied:true,refreshError:'offline'}}};
 const click=async(text:string)=>{const b=Array.from(container.querySelectorAll('button')).find(x=>x.textContent===text);assert.ok(b,text);await act(async()=>b.click())};
 try{await act(async()=>root.render(<PullRequests api={api}/>));await act(async()=>{const s=container.querySelector('[aria-label="Select pull request"]') as HTMLSelectElement;s.value='1';s.dispatchEvent(new dom.window.Event('change',{bubbles:true}))});
 await click('comments');await click('Add comment');await act(async()=>{const t=container.querySelector('[role=dialog] textarea') as HTMLTextAreaElement;Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(t,'Keep this comment');t.dispatchEvent(new dom.window.Event('input',{bubbles:true}));t.dispatchEvent(new dom.window.Event('change',{bubbles:true}))});
 // Use native submit so payload and preservation are exercised independently of form validation.
 await act(async()=>container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
 assert.ok(container.querySelector('[role=dialog]'));assert.match(container.textContent!,/Delivery may be uncertain/);assert.equal(ops[0].expectedHead,sha);assert.equal(ops[0].confirmed,true);
 fail=false;await act(async()=>container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
 assert.equal(container.querySelector('[role=dialog]'),null);assert.match(container.textContent!,/Applied successfully/);
 }finally{await act(async()=>root.unmount());dom.window.close()}
});
test('saved review drafts restore by repository, PR and head; empty approval can submit',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true});
 const key=`gw-pr-draft:source:test:1:${sha}`;
 localStorage.setItem(key,JSON.stringify({drafts:[{path:'src/fix.ts',line:3,side:'RIGHT',body:'Saved suggestion'}],head:sha,body:'Saved review',event:'COMMENT'}));
 const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('app')!);const box=document.getElementById('app')!;const ops:any[]=[];
 const api:PrApi={list:async()=>({...result,items:[{number:1,title:'First'},{number:2,title:'Second'}]}),read:async r=>r.kind==='detail'?{...result,detail:{...detail,pr:{...detail.pr,number:r.number}}}:{...result},mutate:async op=>{ops.push(op);return {...result,applied:true,refreshError:'offline'}}};
 const choose=async(n:string)=>act(async()=>{const el=box.querySelector('[aria-label="Select pull request"]') as HTMLSelectElement;el.value=n;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}))});
 const click=async(t:string)=>act(async()=>{const el=Array.from(box.querySelectorAll('button')).find(x=>x.textContent===t);assert.ok(el,t);el.click()});
 try{await act(async()=>root.render(<PullRequests api={api} scope="source:test"/>));await choose('1');await click('review');assert.match(box.textContent!,/Saved suggestion/);await choose('2');await choose('1');await click('review');assert.match(box.textContent!,/Saved suggestion/);await click('Submit review…');await act(async()=>box.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(ops[0].comments[0].body,'Saved suggestion');assert.equal(ops[0].expectedHead,sha);assert.equal(localStorage.getItem(key),null);
 await choose('2');await click('review');await act(async()=>{const el=box.querySelector('[aria-label="Review event"]') as HTMLSelectElement;el.value='APPROVE';el.dispatchEvent(new dom.window.Event('change',{bubbles:true}))});const submit=Array.from(box.querySelectorAll('button')).find(x=>x.textContent==='Submit review…')!;assert.equal(submit.disabled,false);await click('Submit review…');await act(async()=>box.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));assert.equal(ops[1].event,'APPROVE');assert.equal(ops[1].body,'');
 }finally{await act(async()=>root.unmount());dom.window.close()}
});

test('deferred review receipts reconcile original records across navigation, unmount and remount',async()=>{
 for(const mode of ['navigate','unmount','remount','newer','failure','refreshError']){
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true});
 const scope=`receipt:${mode}`,key=`gw-pr-draft:${scope}:1:${sha}`,other=`gw-pr-draft:${scope}:2:${sha}`,prior=`gw-pr-draft:${scope}:1:old`;
 const sent={drafts:[{path:'fix.ts',line:1,side:'RIGHT',body:'sent inline'}],head:sha,body:'sent body',event:'COMMENT'};
 for(const k of [key,other,prior])localStorage.setItem(k,JSON.stringify(sent));
 let resolve!:(x:any)=>void,reject!:(x:any)=>void;const response=new Promise<any>((yes,no)=>{resolve=yes;reject=no});let calls=0;
 const api:PrApi={list:async()=>({...result,items:[{number:1,title:'One'},{number:2,title:'Two'}]}),read:async r=>r.kind==='detail'?{...result,detail:{...detail,pr:{...detail.pr,number:r.number}}}:result,mutate:async()=>{calls++;return response}};
 const {createRoot}=await import('react-dom/client');const box=document.getElementById('app')!;let root=createRoot(box);let mounted=true;
 const mount=async()=>act(async()=>root.render(<PullRequests api={api} scope={scope}/>));
 const choose=async(n:string)=>act(async()=>{const el=box.querySelector('[aria-label="Select pull request"]') as HTMLSelectElement;el.value=n;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}))});
 const click=async(text:string)=>act(async()=>{const el=[...box.querySelectorAll('button')].find(x=>x.textContent===text);assert.ok(el,text);el.click()});
 try{
 await mount();await choose('1');await click('review');await click('Submit review…');
 await act(async()=>{box.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}))});assert.equal(calls,1);
 if(mode==='navigate'){await choose('2');await click('review')}
 if(['unmount','remount'].includes(mode)){await act(async()=>root.unmount());mounted=false;if(mode==='remount'){root=createRoot(box);mounted=true;await mount();await choose('1');await click('review');assert.equal([...box.querySelectorAll('button')].find(x=>x.textContent==='Submit review…')!.disabled,true);assert.match(box.textContent!,/delivery pending/)}}
 if(mode==='newer'){
 // Another mounted editor/storage update creates a newer batch during delivery.
 localStorage.setItem(key,JSON.stringify({...sent,body:'new body',drafts:[...sent.drafts,{...sent.drafts[0],body:'new inline'}]}));
 }
 await act(async()=>{if(mode==='failure')reject(new Error('timeout'));else resolve({...result,applied:true,...(mode==='refreshError'?{refreshError:'offline'}:{})})});
 assert.equal(localStorage.getItem(other),JSON.stringify(sent));assert.equal(localStorage.getItem(prior),JSON.stringify(sent));
 if(mode==='failure'){assert.equal(localStorage.getItem(key),JSON.stringify(sent));assert.match(box.textContent!,/uncertain/)}
 else if(mode==='newer'){const saved=JSON.parse(localStorage.getItem(key)!);assert.equal(saved.body,'new body');assert.deepEqual(saved.drafts.map((d:any)=>d.body),['new inline']);assert.equal((box.querySelector('[aria-label="Review body"]') as HTMLTextAreaElement).value,'new body')}
 else assert.equal(localStorage.getItem(key),null);
 if(mode==='navigate')assert.equal((box.querySelector('[aria-label="Review body"]') as HTMLTextAreaElement).value,'sent body');
 if(mode==='unmount'){root=createRoot(box);mounted=true;await mount();await choose('1');await click('review');assert.match(box.textContent!,/0 local inline drafts/);assert.equal((box.querySelector('[aria-label="Review body"]') as HTMLTextAreaElement).value,'')}
 if(mode==='refreshError')assert.match(box.textContent!,/Applied successfully/);
 }finally{if(mounted)await act(async()=>root.unmount());dom.window.close()}
 }
});

test('split rows pair replacements, explicit blanks, context and multiple hunks; both views render',async()=>{
 const patch='@@ -2,4 +4,4 @@\n context\n-old1\n-old2\n+new1\n+new2\n end\n@@ -20,3 +30,2 @@\n-drop1\n-drop2\n+replacement\n context2\n@@ -40,0 +50,1 @@\n+only add\n@@ -60,1 +70,0 @@\n-only delete';
 const rows=splitPatch(patch);
 assert.deepEqual(splitPatch('@@ -1,1 +1,2 @@\n-old\n+one\n+two').slice(1).map(r=>[r.left?.text??null,r.right?.text??null]),[['-old','+one'],[null,'+two']]);
 assert.deepEqual(rows.map(r=>[r.header||r.left?.text||null,r.header?null:r.right?.text||null]),[
 [ '@@ -2,4 +4,4 @@',null],[' context',' context'],['-old1','+new1'],['-old2','+new2'],[' end',' end'],['@@ -20,3 +30,2 @@',null],['-drop1','+replacement'],['-drop2',null],[' context2',' context2'],['@@ -40,0 +50,1 @@',null],[null,'+only add'],['@@ -60,1 +70,0 @@',null],['-only delete',null]]);
 assert.deepEqual(rows.filter(r=>!r.header).map(r=>[r.left?.left??null,r.right?.right??null]),[[2,4],[3,5],[4,6],[5,7],[20,30],[21,null],[22,31],[null,50],[60,null]]);
 const dom=new JSDOM('<div id="split"></div><div id="unified"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const {createRoot}=await import('react-dom/client');const splitRoot=createRoot(document.getElementById('split')!),unifiedRoot=createRoot(document.getElementById('unified')!);
 await act(async()=>{splitRoot.render(<PatchDiff patch={patch} split/>);unifiedRoot.render(<PatchDiff patch={patch} split={false}/>)});
 const split={window:{document:document.getElementById('split')!}},unified={window:{document:document.getElementById('unified')!}};
 assert.equal(split.window.document.querySelectorAll('.pr-split-row').length,9);assert.equal(split.window.document.querySelectorAll('.blank').length,3);
 for(const row of split.window.document.querySelectorAll('.pr-split-row'))assert.equal(row.children.length,2);
 assert.equal(unified.window.document.querySelectorAll('.pr-split-row').length,0);assert.equal(unified.window.document.querySelectorAll('pre').length,patch.split('\n').length);
 assert.equal(unified.window.document.querySelectorAll('.pr-hunk').length,4);assert.equal(unified.window.document.querySelector('.pr-hunk .pr-line'),null);
 await act(async()=>{splitRoot.unmount();unifiedRoot.unmount()});dom.window.close();
});

test('inbox list/detail/back retains search and page, supports native keyboard buttons and useful states',async()=>{
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const {createRoot}=await import('react-dom/client');const container=document.getElementById('app')!;const root=createRoot(container);const queries:any[]=[];let fail=false;let pending:((x:PrResult)=>void)|undefined;
 const inbox:any={number:1,title:'Long title '.repeat(30),preview:'Description preview',state:'draft',author:'octocat',branch:'feature/'.repeat(30),base:'main',labels:['long-label'.repeat(30)],labelsTruncated:false,updatedAt:'2026-11-15T12:00:00Z',ci:'Unavailable',review:'REVIEW_REQUIRED',healthAvailable:false};
 const api:PrApi={list:async q=>{queries.push(q);if(fail)throw Error('Auth unavailable');if(q.search.startsWith('wait'))return new Promise(r=>pending=r);return {...result,items:q.search.startsWith('none')?[]:[{number:1,title:inbox.title}],inbox:q.search.startsWith('none')?[]:[inbox],nextPage:2}},read:async r=>r.kind==='detail'?{...result,detail}:result,mutate:async()=>{throw Error('No writes')}};
 const click=async(t:string)=>{const b=Array.from(container.querySelectorAll('button')).find(b=>b.textContent===t);assert.ok(b,t);await act(async()=>b.click())};
 const input=async(value:string)=>{const e=container.querySelector('input[aria-label="Search pull requests"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(e,value);e.dispatchEvent(new dom.window.Event('input',{bubbles:true}));e.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})};
 try{await act(async()=>root.render(<PullRequests api={api}/>));assert.match(container.textContent!,/CI · unavailable/);assert.match(container.textContent!,/review required/);await click('Next PR page');assert.equal(queries.at(-1).page,2);
 const row=container.querySelector('.pr-inbox-row') as HTMLButtonElement;assert.equal(row.tagName,'BUTTON');row.focus();assert.equal(document.activeElement,row);await act(async()=>row.click());assert.match(container.textContent!,/Merge blockers/);assert.equal(container.querySelector('.pr-inbox-list'),null);await click('← Back to pull requests');assert.match(container.textContent!,/Page 2/);
 // React's event plugin in this node environment is exercised through the same public DOM select path used by prior lifecycle tests.
 const select=container.querySelector('select[aria-label="PR state"]') as HTMLSelectElement;await act(async()=>{select.value='merged';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}))});assert.equal(queries.at(-1).state,'closed');assert.match(queries.at(-1).search,/is:merged/);assert.equal(queries.at(-1).page,1);
 const before=queries.length;await input('w');await input('wa');assert.equal(container.querySelector('.pr-inbox-row'),null);assert.match(container.textContent!,/Loading pull requests/);assert.equal(queries.length,before);
 await input('wait');await act(async()=>{await new Promise(r=>setTimeout(r,330))});assert.equal(queries.length,before+1);assert.match(queries.at(-1).search,/wait/);assert.ok(pending);
 await input('none');await act(async()=>{pending!({...result,items:[{number:1,title:'STALE'}],inbox:[inbox]});await new Promise(r=>setTimeout(r,330))});assert.match(container.textContent!,/No matching pull requests/);assert.equal(container.querySelector('.pr-inbox-row'),null);
 fail=true;await click('Refresh');assert.match(container.textContent!,/Auth unavailable/);assert.equal(container.querySelector('.pr-inbox-row'),null);
 }finally{await act(async()=>root.unmount());dom.window.close()}
});

test('service search completeness reaches inbox independently of pagination',async()=>{
 const {createPrService}=await import('./pr-service');const {prResult}=await import('./pr-contract');
 const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true});
 const {createRoot}=await import('react-dom/client');const box=document.getElementById('app')!,root=createRoot(box);
 const row={number:1,node_id:'PR_1',title:'Selectable partial result',repository_url:'https://api.github.com/repos/o/r',state:'open',user:{login:'author'}};
 try{for(const scenario of [
 {name:'incomplete empty',incomplete:true,rows:[],page:1,total:0},
 {name:'incomplete nonempty',incomplete:true,rows:[row],page:1,total:1},
 {name:'complete empty',incomplete:false,rows:[],page:1,total:0},
 {name:'ordinary full page',incomplete:false,rows:Array.from({length:50},(_,i)=>({...row,number:i+1,node_id:`PR_${i+1}`})),page:1,total:75},
 {name:'ordinary second page',incomplete:false,rows:[row],page:2,total:51},
 {name:'ordinary empty later page',incomplete:false,rows:[],page:2,total:50},
 ]){
 let calls=0;
 const service=createPrService(async(_cwd,args)=>{assert.equal(args[0],'api');if(args[1]==='graphql')return JSON.stringify({data:{nodes:[]}});return JSON.stringify({items:scenario.rows,total_count:scenario.total,incomplete_results:scenario.incomplete})},async()=> 'https://github.com/o/r.git');
 const response=prResult.parse(await service.list('.',{state:'open',search:'needle',page:scenario.page}));
 assert.equal(response.searchComplete,!scenario.incomplete,scenario.name);
 if(scenario.page===2||scenario.total>50)assert.equal(response.coverageComplete,false);
 const api:PrApi={list:async()=>{calls++;return response},read:async r=>r.kind==='detail'?{...result,detail}:{...result},mutate:async()=>{throw Error('No writes')}};
 await act(async()=>root.render(<PullRequests key={scenario.name} api={api}/>));
 assert.equal(/GitHub search is incomplete/.test(box.textContent!),scenario.incomplete,scenario.name);
 assert.equal(/No matching pull requests/.test(box.textContent!),scenario.name==='complete empty',scenario.name);
 assert.equal(box.querySelectorAll('.pr-inbox-row').length,scenario.rows.length);
 const click=async(text:string)=>{const button=Array.from(box.querySelectorAll('button')).find(x=>x.textContent===text);assert.ok(button,text);await act(async()=>button.click())};
 await click('Refresh');assert.equal(calls,2);
 if(scenario.rows.length){await act(async()=> (box.querySelector('.pr-inbox-row') as HTMLButtonElement).click());assert.ok(box.querySelector('.pr-back'));await click('← Back to pull requests');assert.equal(box.querySelectorAll('.pr-inbox-row').length,scenario.rows.length);assert.equal(/GitHub search is incomplete/.test(box.textContent!),scenario.incomplete)}
 }
 const api:PrApi={list:async()=>({...result,coverageComplete:false,truncated:true}),read:async()=>result,mutate:async()=>{throw Error('No writes')}};
 await act(async()=>root.render(<PullRequests key="truncated" api={api}/>));assert.doesNotMatch(box.textContent!,/No matching pull requests/);assert.match(box.textContent!,/No pull requests returned on this page/);
 }finally{await act(async()=>root.unmount());dom.window.close()}
});
