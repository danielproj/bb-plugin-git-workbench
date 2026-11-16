import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {act} from 'react';
import {installTestPluginRuntime} from '@get-bb/plugin-sdk/testing/app';
import {Checks,checkState,duration,webUrl} from './checks';
import {prResult} from './pr-contract';
installTestPluginRuntime();
test('CI display preserves skipped, unknown and pending states and only derives valid completed durations',()=>{
 assert.equal(checkState('completed','success').tone,'good');assert.equal(checkState('completed','skipped').tone,'neutral');assert.equal(checkState('completed',null).label,'Unknown');assert.equal(checkState('in_progress').label,'Running');assert.equal(checkState('completed','failure').tone,'bad');
 assert.equal(duration('2026-01-01T00:00:00Z','2026-01-01T00:02:04Z'),'2m 4s');assert.equal(duration('broken','also broken'),null);assert.equal(duration('2026-01-02','2026-01-01'),null);assert.equal(duration('2026-01-01',null),null);
 for(const url of ['javascript:alert(1)','file:///secret','https://user:password@example.com'])assert.equal(webUrl(url),undefined);
 assert.equal(webUrl('https://github.com/o/r/actions/runs/1'),'https://github.com/o/r/actions/runs/1');
});
test('check cards expose sourced metadata, separate summaries, external links and guarded workflow controls',async()=>{
 const d=new JSDOM('<div id="app"></div>',{url:'http://localhost'});Object.assign(globalThis,{window:d.window,document:d.window.document,HTMLElement:d.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const {createRoot}=await import('react-dom/client'),box=document.getElementById('app')!,root=createRoot(box);let action='',read='';
 const result=prResult.parse({items:[],coverageComplete:true,nextPage:null,text:'',truncated:false,runsCoverageComplete:true,checks:{head:'a'.repeat(40),requiredCoverage:'complete',contexts:[{__typename:'CheckRun',name:'Tests',isRequired:true,conclusion:'SUCCESS'}],statuses:[],checkRuns:[{id:1,name:'Tests',status:'completed',conclusion:'success',details_url:'https://github.com/o/r/actions/runs/5/job/6',app:{name:'GitHub Actions'},started_at:'2026-01-01T00:00:00Z',completed_at:'2026-01-01T00:02:04Z',output:{title:'All tests passed',summary:'**12** tests passed.',text:null}},{id:2,name:'Browser image',status:'completed',conclusion:'skipped',details_url:'javascript:alert(1)',output:{title:null,summary:null,text:null}}]},runs:[{id:5,name:'CI',run_number:42,run_attempt:2,head_sha:'a'.repeat(40),status:'completed',conclusion:'success',html_url:'https://github.com/o/r/actions/runs/5',head_branch:'feature',event:'pull_request'}]});
 const render=(enabled:boolean)=>root.render(<Checks result={result} head={'a'.repeat(40)} canAct={enabled} onReadRun={(kind,id)=>{read=`${kind}:${id}`;}} onAction={(kind,id)=>{action=`${kind}:${id}`;}}/>);
 try{
  await act(async()=>render(false));assert.match(box.textContent!,/2m 4s/);assert.match(box.textContent!,/GitHub Actions/);assert.match(box.textContent!,/Required/);assert.match(box.textContent!,/Attempt 2/);assert.match(box.textContent!,/Skipped & other/);
  const link=box.querySelector('a[aria-label^="Tests"]') as HTMLAnchorElement;assert.equal(link.target,'_blank');assert.equal(link.href,'https://github.com/o/r/actions/runs/5/job/6');assert.equal(link.rel,'noreferrer');assert.equal(box.querySelector('[href^="javascript:"]'),null);
  assert.ok(box.querySelector('.pr-check-output summary'));assert.equal(box.querySelector('.pr-check-output')?.hasAttribute('open'),false);
  const rerun=[...box.querySelectorAll('button')].find(b=>b.textContent==='Rerun failed…')!;assert.equal(rerun.disabled,true);await act(async()=>render(true));await act(async()=>rerun.click());assert.equal(action,'rerun:5');
  await act(async()=>[...box.querySelectorAll('button')].find(b=>b.textContent==='Jobs')!.click());assert.equal(read,'jobs:5');
 }finally{await act(async()=>root.unmount());d.window.close();}
});
