import {posix,win32} from 'node:path';
import type {BbPluginApi} from '@get-bb/plugin-sdk';
import type {GitIdentity} from './catalog-host';
import {repositoryId} from './catalog';
import {cloneRequest,type CloneRequest,type CloneJob} from './clone-contract';
import type {Repository} from './contract';
type Sdk=Pick<BbPluginApi['sdk'],'projects'|'hosts'>;
type Transport={
 directory:(hostId:string,signal?:AbortSignal)=>Promise<{directory:string}>;
 clone:(hostId:string,path:string,remoteUrl:string,signal:AbortSignal)=>Promise<GitIdentity>;
 verify:(hostId:string,identity:GitIdentity,remoteUrl:string,signal:AbortSignal)=>Promise<unknown>;
 catalog:(projectId:string)=>Promise<{repositories:Repository[]}>;
 resolve:(id:string)=>Promise<unknown>;
};
type Record={request:CloneRequest;signature:string;job:CloneJob;identity?:GitIdentity;controller?:AbortController};
export function createCloneService(sdk:()=>Sdk,transport:Transport){
 const records=new Map<string,Record>(),pending=new Map<string,Promise<void>>(),destinations=new Map<string,string>();
 let disposed=false;
 const destination=(r:CloneRequest)=>JSON.stringify([r.hostId,(/^(?:[A-Za-z]:|\\\\)/.test(r.path)?win32:posix).normalize(r.path)]);
 const signature=(r:CloneRequest)=>JSON.stringify([r.hostId,r.path,r.remoteUrl,r.name]);
 async function machine(id:string){
  const host=(await sdk().hosts.list()).find(h=>h.id===id);
  if(!host||host.status!=='connected'||host.type!=='persistent'||host.lifecycle.phase!=='active')throw Error('The selected machine is unavailable. Connect it and retry.');
  return host;
 }
 async function options(signal?:AbortSignal){
  const hosts=(await sdk().hosts.list()).filter(h=>h.status==='connected'&&h.type==='persistent'&&h.lifecycle.phase==='active');
  const warnings:string[]=[];
  const rows=await Promise.all(hosts.map(async h=>{try{return {id:h.id,name:h.name,...await transport.directory(h.id,signal)};}catch{warnings.push(`${h.name}: could not load the checkout directory.`);return null;}}));
  return {hosts:rows.filter((h):h is NonNullable<typeof h>=>!!h),warnings};
 }
 async function status(id:string):Promise<CloneJob>{
  const record=records.get(id);
  if(!record)throw Error('Clone status is no longer available. Refresh repositories to check whether the checkout completed.');
  if(record.job.status==='ready')try{await transport.resolve(record.job.repository!.id);}catch(e){record.job={...record.job,status:'failed',message:`Checkout is no longer available: ${(e as Error).message}. Refresh repositories.`};}
  return {...record.job};
 }
 async function prepare(record:Record){
  const {request:r}=record,controller=new AbortController();record.controller=controller;
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(360000)]);
  try{
   const host=await machine(r.hostId);signal.throwIfAborted();
   if(!record.identity){
    record.job={...record.job,status:'cloning',message:`Cloning on ${host.name}…`};
    record.identity=await transport.clone(r.hostId,r.path,r.remoteUrl,signal);
    record.job={...record.job,checkoutCreated:true};
   }
   signal.throwIfAborted();
   await transport.verify(r.hostId,record.identity,r.remoteUrl,signal);
   record.job={...record.job,status:'registering',message:'Registering the checkout as a BB project…'};
   let project;
   if(record.job.projectId){
    project=await sdk().projects.get({projectId:record.job.projectId});
    if(!project.sources.some(s=>s.hostId===r.hostId&&s.path===record.identity!.root))throw Error('The project’s source changed. Refresh repositories.');
   }else{
    // Also recover a successful create whose response was lost before acknowledgement.
    const matches=(await sdk().projects.list()).filter(p=>p.kind!=='personal'&&p.sources.some(s=>s.hostId===r.hostId&&s.path===record.identity!.root));
    if(matches.length>1)throw Error('Multiple projects use this checkout. Select its repository from the picker.');
    project=matches[0]||await sdk().projects.create({name:r.name,source:{type:'local_path',hostId:r.hostId,path:record.identity.root}});
    record.job={...record.job,projectId:project.id};
   }
   signal.throwIfAborted();
   const expected=repositoryId(r.hostId,record.identity);
   const result=await transport.catalog(project.id);
   const repo=result.repositories.find(x=>x.id===expected&&x.hostId===r.hostId&&x.projectIds?.includes(project.id));
   if(!repo)throw Error('Checkout was registered but could not be verified in the repository catalog. Retry or refresh repositories.');
   if(!disposed)record.job={...record.job,status:'ready',repository:repo,message:'Repository cloned and ready to open.'};
  }catch(e){if(!disposed)record.job={...record.job,status:'failed',message:`${(e as Error).message}${record.identity?' The cloned files have been preserved; retry resumes registration.':''}`};}
  finally{record.controller=undefined;}
 }
 async function start(input:CloneRequest):Promise<CloneJob>{
  if(disposed)throw Error('Plugin reloaded. Refresh repositories before retrying.');
  const r=cloneRequest.parse(input),current=records.get(r.id),binding=signature(r);
  if(current&&current.signature!==binding)throw Error('This clone request belongs to another URL, machine or destination. Start a new request.');
  if(current&&(pending.has(r.id)||current.job.status!=='failed'||!r.retry))return status(r.id);
  // Reserve before asynchronous host validation and cloning, so duplicate submissions share a job.
  const rechecked=records.get(r.id);
  if(rechecked&&rechecked.signature!==binding)throw Error('This clone request belongs to another URL, machine or destination. Start a new request.');
  if(rechecked&&(pending.has(r.id)||rechecked.job.status!=='failed'||!r.retry))return status(r.id);
  const occupied=destinations.get(destination(r));
  if(occupied&&occupied!==r.id){const other=records.get(occupied);if(other?.signature===binding)return status(occupied);throw Error('Another clone is using this destination. Choose another directory.');}
  if(!current&&records.size>=100){for(const [id,record] of records){if(!pending.has(id)){records.delete(id);break;}}if(records.size>=100)throw Error('Too many clone operations are running. Try again shortly.');}
  const record=rechecked||current||{request:r,signature:binding,job:{id:r.id,status:'cloning' as const,message:'Preparing clone…',hostId:r.hostId,path:r.path,remoteUrl:r.remoteUrl,name:r.name,checkoutCreated:false}};
  record.job={...record.job,status:record.identity?'registering':'cloning',message:record.identity?'Resuming checkout registration…':'Preparing clone…'};
  records.set(r.id,record);destinations.set(destination(r),r.id);
  const promise=prepare(record).finally(()=>{pending.delete(r.id);if(destinations.get(destination(r))===r.id)destinations.delete(destination(r));});
  pending.set(r.id,promise);return {...record.job};
 }
 return {options,start,status,async wait(id:string){await pending.get(id);return status(id);},dispose(){disposed=true;for(const r of records.values())r.controller?.abort();}};
}
