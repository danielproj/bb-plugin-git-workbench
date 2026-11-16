import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,stat,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createFakeSdk,createFakePluginHost,makeHostResponse} from '@get-bb/plugin-sdk/testing';
import {cloneRequest,normalizeRemote,repositoryName,checkoutPath} from './clone-contract';
import {cloneRepository,verifyClone} from './clone-host';
import {createCloneService} from './clone-service';
import {git} from './git';
import {repositoryId} from './catalog';
import {scanRepositories,gitIdentity} from './catalog-host';
import plugin from './server';

const remote='https://example.test/owner/repository.git';
const request=(extra:object={})=>cloneRequest.parse({id:randomUUID(),confirmed:true,hostId:'host:one',remoteUrl:remote,path:'/projects/repository',name:'Repository',...extra});
const host=makeHostResponse({id:'host:one',name:'Selected Mac',status:'connected',type:'persistent',lifecycle:{phase:'active',message:null,pendingLog:'',suspendedAt:null,teardown:null}});
const identity={root:'/projects/repository',commonDir:'/projects/repository/.git',incarnation:'test:1'};
const projectFor=(root:string)=>({id:'project:new',kind:'standard' as const,name:'Repository',gitRemoteUrl:remote,sources:[{id:'source:new',projectId:'project:new',hostId:host.id,path:root,type:'local_path' as const,isDefault:true,createdAt:1,updatedAt:1}],createdAt:1,updatedAt:1});

test('clone input supports HTTPS and SSH, rejects credentials, unsafe protocols and missing confirmation',()=>{
 assert.equal(normalizeRemote(` ${remote} `),remote);
 assert.equal(normalizeRemote('git@example.test:owner/repository.git'),'git@example.test:owner/repository.git');
 assert.equal(normalizeRemote('ssh://git@example.test/owner/repository.git'),'ssh://git@example.test/owner/repository.git');
 for(const value of ['ext::echo bad','file:///tmp/repo','/tmp/repo','http://example.test/a','https://user:token@example.test/a','https://example.test/a?token=secret','https://example.test/a#branch','git@example.test:repo\ncommand'])assert.throws(()=>normalizeRemote(value));
 assert.throws(()=>request({confirmed:false}));assert.throws(()=>request({path:'relative/repo'}));
 assert.equal(repositoryName(remote),'repository');assert.equal(checkoutPath('C:\\Projects\\','repo'),'C:\\Projects\\repo');
});
async function localGit(fn:(root:string,run:typeof git)=>Promise<void>){
 const root=await mkdtemp(path.join(tmpdir(),'gw-clone-test-')),source=path.join(root,'source');
 try{
  await mkdir(source);await git(source,['init','-b','main']);await git(source,['config','user.name','Test']);await git(source,['config','user.email','test@example.com']);await git(source,['config','commit.gpgsign','false']);
  await writeFile(path.join(source,'README.md'),'cloned content\n');await git(source,['add','.']);await git(source,['commit','-m','Base']);
  const run:typeof git=(cwd,args,signal,input,allowFailure,timeout)=>git(cwd,['-c','clone.defaultRemoteName=upstream','-c','protocol.file.allow=always','-c',`url.${source}.insteadOf=${remote}`,...args],signal,input,allowFailure,timeout);
  await fn(root,run);
 }finally{await rm(root,{recursive:true,force:true});}
}
test('real Git clone checks out the default branch, preserves occupied folders, and keeps canonical identity',()=>localGit(async(root,run)=>{
 const parent=path.join(root,'checkouts');await mkdir(parent);const alias=path.join(root,'alias');await symlink(parent,alias,'dir');
 const target=path.join(alias,'new checkout'),result=await cloneRepository(target,remote,undefined,run);
 assert.equal(result.root,await realpath(target));assert.equal((await git(result.root,['branch','--show-current'])).trim(),'main');assert.equal(await readFile(path.join(target,'README.md'),'utf8'),'cloned content\n');
 await verifyClone(result,remote);
 await writeFile(path.join(target,'README.md'),'keep local work');await assert.rejects(cloneRepository(target,remote,undefined,run),/already exists/);assert.equal(await readFile(path.join(target,'README.md'),'utf8'),'keep local work');
 const occupied=path.join(root,'empty');await mkdir(occupied);await assert.rejects(cloneRepository(occupied,remote,undefined,run),/already exists/);
 const dangling=path.join(root,'dangling');await symlink(path.join(root,'absent'),dangling);await assert.rejects(cloneRepository(dangling,remote,undefined,run),/already exists/);
 await assert.rejects(cloneRepository(path.join(target,'.git','nested'),remote,undefined,run),/metadata/);
 await assert.rejects(cloneRepository(path.join(target,'.GiT','nested'),remote,undefined,run),/metadata/);
 await git(target,['config','remote.origin.url','https://example.test/other.git']);await assert.rejects(verifyClone(result,remote),/origin changed/);
}));
test('clone promotion refuses a destination created concurrently and cleans only its own staging files',()=>localGit(async(root,run)=>{
 const target=path.join(root,'raced');
 const racing:typeof git=async(cwd,args,...rest)=>{const result=await run(cwd,args,...rest);if(args[0]==='clone'){await mkdir(target);await writeFile(path.join(target,'keep'),'other process');}return result;};
 await assert.rejects(cloneRepository(target,remote,undefined,racing),/EEXIST/);assert.equal(await readFile(path.join(target,'keep'),'utf8'),'other process');assert.equal((await readdir(root)).some(p=>p.startsWith('.gw-clone-')),false);
 const controller=new AbortController(),aborted=path.join(root,'aborted');controller.abort();await assert.rejects(cloneRepository(aborted,remote,controller.signal,run));await assert.rejects(stat(aborted));
}));
function fixture(){
 let projects:ReturnType<typeof projectFor>[]=[],cloneCalls=0,failCreate=false,loseAck=false,changed=false;
 const fake=createFakeSdk({pluginId:'git-workbench',overrides:{hosts:{list:async()=>[host]},projects:{list:async()=>projects,get:async({projectId})=>{const p=projects.find(p=>p.id===projectId);if(!p)throw Error('Unknown project');return p;},create:async()=>{if(failCreate)throw Error('Registration unavailable');const p=projectFor(identity.root);projects.push(p);if(loseAck){loseAck=false;throw Error('Acknowledgement lost');}return p;}}}});
 const transport={directory:async()=>({directory:'/projects'}),clone:async()=>{cloneCalls++;return identity;},verify:async()=>{if(changed)throw Error('Clone identity changed');},catalog:async(projectId:string)=>({repositories:[{id:repositoryId(host.id,identity),name:'repository',path:identity.root,hostId:host.id,projectIds:[projectId]}]}),resolve:async()=>{if(changed)throw Error('Clone identity changed');}};
 const service=createCloneService(()=>fake.sdk,transport);
 return {fake,service,transport,get cloneCalls(){return cloneCalls;},set failCreate(v:boolean){failCreate=v;},set loseAck(v:boolean){loseAck=v;},set changed(v:boolean){changed=v;},get projects(){return projects;}};
}
test('clone jobs deduplicate submissions, bind URL/host/path, and register once without creating a thread',async()=>{
 const f=fixture(),r=request();
 const started=await Promise.all(Array.from({length:8},()=>f.service.start(r)));assert.ok(started.every(s=>s.id===r.id));
 const ready=await f.service.wait(r.id);assert.equal(ready.status,'ready');assert.equal(f.cloneCalls,1);assert.equal(f.fake.harness.callsTo('projects.create').length,1);assert.equal(f.fake.harness.callsTo('threads.spawn').length,0);
 await assert.rejects(f.service.start({...r,remoteUrl:'https://example.test/other.git'}),/belongs to another/);
 await assert.rejects(f.service.start({...r,hostId:'host:two'}),/belongs to another/);await assert.rejects(f.service.start({...r,path:'/other'}),/belongs to another/);
 f.changed=true;assert.equal((await f.service.status(r.id)).status,'failed');f.service.dispose();
});
test('registration retries reuse the verified clone and recover a lost project-create acknowledgement',async()=>{
 for(const lost of [false,true]){
  const f=fixture(),r=request();if(lost)f.loseAck=true;else f.failCreate=true;
  await f.service.start(r);const failed=await f.service.wait(r.id);assert.equal(failed.status,'failed');assert.equal(failed.checkoutCreated,true);assert.equal(f.cloneCalls,1);
  f.failCreate=false;await f.service.start({...r,retry:true});assert.equal((await f.service.wait(r.id)).status,'ready');assert.equal(f.cloneCalls,1);assert.equal(f.projects.length,1);assert.equal(f.fake.harness.callsTo('projects.delete').length,0);
  f.service.dispose();
 }
 const f=fixture(),r=request();f.failCreate=true;await f.service.start(r);await f.service.wait(r.id);f.changed=true;f.failCreate=false;await f.service.start({...r,retry:true});assert.equal((await f.service.wait(r.id)).status,'failed');assert.equal(f.projects.length,0);f.service.dispose();
});
test('offline machine is never replaced by a different connected host',async()=>{
 const f=fixture();f.fake.harness.stub('hosts.list',async()=>[{...host,status:'disconnected'},makeHostResponse({id:'host:other',status:'connected'})]);
 const r=request();await f.service.start(r);const result=await f.service.wait(r.id);assert.equal(result.status,'failed');assert.match(result.message,/selected machine is unavailable/);assert.equal(f.cloneCalls,0);assert.equal(f.projects.length,0);f.service.dispose();
});
test('in-flight requests cannot change scope, destination jobs coalesce, and disposal prevents registration',async()=>{
 const f=fixture();let aborted=false;
 const service=createCloneService(()=>f.fake.sdk,{...f.transport,clone:async(_host,_path,_remote,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('Aborted'));},{once:true}))});
 const r=request();await service.start(r);await Promise.resolve();
 for(const change of [{hostId:'host:other'},{path:'/other'},{name:'Different'},{remoteUrl:'https://example.test/other.git'}])await assert.rejects(service.start({...r,...change}),/belongs to another/);
 const alias=await service.start({...r,id:randomUUID()});assert.equal(alias.id,r.id);
 await assert.rejects(service.start({...r,id:randomUUID(),remoteUrl:'https://example.test/other.git'}),/using this destination/);
 service.dispose();const result=await service.wait(r.id);assert.equal(aborted,true);assert.notEqual(result.status,'ready');assert.equal(f.projects.length,0);f.service.dispose();
});
test('production RPC clones, registers a source, discovers its identity and reads the new checkout',()=>localGit(async(root,run)=>{
 const destination=path.join(root,'new-repository');let project:ReturnType<typeof projectFor>|undefined;
 const {bb,harness}=createFakePluginHost({pluginId:'git-workbench',sdk:{hosts:{list:async()=>[host]},environments:{list:async()=>[]},projects:{list:async()=>project?[project]:[],get:async()=>{if(!project)throw Error('Not found');return project;},create:async input=>{project={...projectFor(input.source.path),name:input.name};return project;}}},experimental_callHostRpc:async({method,input,hostId,signal})=>{
  assert.equal(hostId,host.id);const value=input as any;
  if(method==='cloneDirectory')return {directory:root};
  if(method==='cloneRepository')return cloneRepository(value.path,value.remoteUrl,signal,run);
  if(method==='verifyClone')return verifyClone(value.identity,value.remoteUrl,signal);
  if(method==='scanRepositories')return scanRepositories(value.roots,signal);
  if(method==='gitIdentity')return gitIdentity(value.path,signal);
  if(method==='snapshot'){const {getSnapshot}=await import('./git');return getSnapshot(value.cwd,value.query,signal);}
  throw Error('Unexpected host call '+method);
 }});
 try{
  plugin(bb);const r=request({path:destination});await assert.rejects(harness.behavior.callRpc('cloneStart',{...r,confirmed:false}));
  const choices:any=await harness.behavior.callRpc('cloneOptions',{});assert.equal(choices.hosts[0].directory,root);
  let job:any=await harness.behavior.callRpc('cloneStart',r);
  for(let i=0;i<300&&!['ready','failed'].includes(job.status);i++){await new Promise(r=>setTimeout(r,10));job=await harness.behavior.callRpc('cloneStatus',{id:r.id});}
  assert.equal(job.status,'ready',job.message);assert.ok(job.repository.id.startsWith('repo:'));assert.equal(project?.sources[0].path,await realpath(destination));
  const snapshot:any=await harness.behavior.callRpc('snapshot',{environmentId:job.repository.id,query:{limit:10}});assert.equal(snapshot.branch,'main');assert.equal(snapshot.files.length,0);
 }finally{await harness.lifecycle.dispose();}
}));
