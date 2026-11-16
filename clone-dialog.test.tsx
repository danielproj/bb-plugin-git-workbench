import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {act} from 'react';
import type {CloneApi,CloneActivity} from './clone-dialog';
import type {CloneJob,CloneRequest} from './clone-contract';
// Initialize a DOM before React DOM is loaded by the SDK test runtime.
const bootstrap=new JSDOM('<div></div>',{url:'http://localhost'});
Object.assign(globalThis,{window:bootstrap.window,document:bootstrap.window.document,HTMLElement:bootstrap.window.HTMLElement});
const {installTestPluginRuntime}=await import('@get-bb/plugin-sdk/testing/app');
const {CloneRepositoryDialog}=await import('./clone-dialog');
installTestPluginRuntime();bootstrap.window.close();
const remote='https://example.test/owner/new-repository.git';
const repo={id:'repo:new',name:'new-repository',path:'/projects/new-repository',hostId:'host:two',projectIds:['project:new']};
const options={hosts:[{id:'host:one',name:'Mac One',directory:'/one'},{id:'host:two',name:'Mac Two',directory:'/projects'}],warnings:[]};
function dom(){const d=new JSDOM('<div id="app"></div>',{url:'http://localhost'});Object.assign(globalThis,{window:d.window,document:d.window.document,HTMLElement:d.window.HTMLElement,localStorage:d.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true});return d;}
const jobFor=(r:CloneRequest,status:CloneJob['status']='cloning'):CloneJob=>({id:r.id,status,message:'Cloning…',hostId:r.hostId,path:r.path,remoteUrl:r.remoteUrl,name:r.name,checkoutCreated:false,...(status==='ready'?{checkoutCreated:true,message:'Ready',projectId:'project:new',repository:repo}:{})});
async function type(d:JSDOM,label:string,value:string){await act(async()=>{const e=document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;assert.ok(e,label);Object.getOwnPropertyDescriptor(d.window.HTMLInputElement.prototype,'value')!.set!.call(e,value);e.dispatchEvent(new d.window.Event('input',{bubbles:true}));e.dispatchEvent(new d.window.Event('change',{bubbles:true}));});}

test('clone form derives the name/path on the selected machine and creates nothing until explicit submit',async()=>{
 const d=dom(),{createRoot}=await import('react-dom/client'),box=document.getElementById('app')!,root=createRoot(box);const requests:CloneRequest[]=[];let latest:CloneJob|undefined,opened=0;
 const api:CloneApi={options:async()=>options,start:async r=>{requests.push(r);return latest=jobFor(r);},status:async()=>latest!};
 try{
  await act(async()=>root.render(<CloneRepositoryDialog api={api} open onClose={()=>{}} onOpen={()=>{opened++;}} onActivityChange={()=>{}} preferredHostId="host:two"/>));
  assert.equal((box.querySelector('[aria-label="Clone machine"]') as HTMLSelectElement).value,'host:two');assert.equal(requests.length,0);
  await type(d,'Repository URL',remote);assert.equal((box.querySelector('[aria-label="Project name"]') as HTMLInputElement).value,'new-repository');assert.equal((box.querySelector('[aria-label="Destination folder"]') as HTMLInputElement).value,'/projects/new-repository');
  await type(d,'Project name','New Project');await type(d,'Destination folder','/projects/my checkout');
  await act(async()=>box.querySelector('form')!.dispatchEvent(new d.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(requests.length,1);assert.equal(requests[0].hostId,'host:two');assert.equal(requests[0].path,'/projects/my checkout');assert.equal(requests[0].name,'New Project');assert.equal(requests[0].confirmed,true);assert.equal(opened,0);assert.match(box.textContent!,/Cloning repository/);
 }finally{await act(async()=>root.unmount());d.window.close();}
});
test('clone progress resumes after unmount without resubmission and a closed dialog never switches repositories',async()=>{
 const d=dom(),{createRoot}=await import('react-dom/client'),box=document.getElementById('app')!;let root=createRoot(box),request:CloneRequest|undefined,latest:CloneJob|undefined,starts=0,opened=0,activity:CloneActivity='idle';
 const onActivity=(value:CloneActivity)=>{activity=value;},onOpen=()=>{opened++;};
 const api:CloneApi={options:async()=>options,start:async r=>{starts++;request=r;return latest=jobFor(r);},status:async()=>latest!};
 const render=(open:boolean,canOpen=true)=>root.render(<CloneRepositoryDialog api={api} open={open} onClose={()=>{}} onOpen={onOpen} onActivityChange={onActivity} preferredHostId="host:two" canOpen={canOpen}/>);
 try{
  await act(async()=>render(true));await type(d,'Repository URL',remote);await act(async()=>box.querySelector('form')!.dispatchEvent(new d.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.ok(request);assert.equal(starts,1);await act(async()=>root.unmount());latest=jobFor(request!,'ready');root=createRoot(box);await act(async()=>render(false));assert.equal(starts,1);assert.equal(opened,0);assert.equal(activity,'ready');
  await act(async()=>render(true,false));assert.equal(opened,0);assert.match(box.textContent!,/save your commit draft/);
  await act(async()=>render(true,true));assert.equal(opened,1);assert.equal(window.sessionStorage.getItem('bb.git-workbench.clone-job'),null);assert.equal(starts,1);
 }finally{await act(async()=>root.unmount());d.window.close();}
});
test('failed registration retry keeps the original request binding and does not silently change machines',async()=>{
 const d=dom(),{createRoot}=await import('react-dom/client'),box=document.getElementById('app')!,root=createRoot(box),requests:CloneRequest[]=[];let latest:CloneJob|undefined,opened=0;
 const api:CloneApi={options:async()=>options,start:async r=>{requests.push(r);return latest=requests.length===1?{...jobFor(r),status:'failed',checkoutCreated:true,message:'Registration unavailable. Cloned files preserved.'}:jobFor(r,'ready');},status:async()=>latest!};
 try{
  await act(async()=>root.render(<CloneRepositoryDialog api={api} open onClose={()=>{}} onOpen={()=>{opened++;}} onActivityChange={()=>{}} preferredHostId="host:two"/>));await type(d,'Repository URL',remote);
  await act(async()=>box.querySelector('form')!.dispatchEvent(new d.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.match(box.textContent!,/Cloned files preserved/);assert.equal((box.querySelector('[aria-label="Clone machine"]') as HTMLSelectElement).disabled,true);
  await act(async()=>[...box.querySelectorAll('button')].find(b=>b.textContent==='Retry registration')!.click());
  assert.equal(requests.length,2);assert.equal(requests[1].id,requests[0].id);assert.equal(requests[1].hostId,'host:two');assert.equal(requests[1].path,requests[0].path);assert.equal(requests[1].retry,true);assert.equal(opened,1);
 }finally{await act(async()=>root.unmount());d.window.close();}
});
test('credential-bearing and unsafe URLs cannot start a clone or persist a request',async()=>{
 const d=dom(),{createRoot}=await import('react-dom/client'),box=document.getElementById('app')!,root=createRoot(box);let starts=0;
 const api:CloneApi={options:async()=>options,start:async()=>{starts++;throw Error('Unexpected write');},status:async()=>{throw Error('Unexpected poll');}};
 try{
  await act(async()=>root.render(<CloneRepositoryDialog api={api} open onClose={()=>{}} onOpen={()=>{}} onActivityChange={()=>{}}/>));await type(d,'Repository URL','https://user:fake-token@example.test/owner/repo.git');
  await act(async()=>box.querySelector('form')!.dispatchEvent(new d.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal((box.querySelector('[aria-label="Repository URL"]') as HTMLInputElement).value,'https://user:fake-token@example.test/owner/repo.git');assert.equal(starts,0);assert.equal(window.sessionStorage.getItem('bb.git-workbench.clone-job'),null);assert.match(box.querySelector('.gw-clone-error')!.textContent!,/instead of including credentials/);
 }finally{await act(async()=>root.unmount());d.window.close();}
});
