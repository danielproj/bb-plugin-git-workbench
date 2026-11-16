import {test} from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {ViewCache,cacheKey,retainCatalog} from './view-cache';
import {catalogSchema} from './read-contract';
const schema=z.object({name:z.string()});
function storage(){const values=new Map<string,string>();return {values,getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>{values.set(key,value);}};}
test('display cache persists valid responses, rejects malformed storage and keeps exact target/query keys',()=>{
 const disk=storage(),cache=new ViewCache(disk),a=cacheKey('snapshot','repo:a','/a',{branch:'main'}),b=cacheKey('snapshot','repo:b','/a',{branch:'main'});
 cache.set(a,{name:'A'});assert.equal(new ViewCache(disk).get(a,schema)?.value.name,'A');
 assert.equal(cache.get(b,schema),undefined);assert.equal(cache.get(cacheKey('snapshot','repo:a','/b',{branch:'main'}),schema),undefined);assert.equal(cache.get(cacheKey('snapshot','repo:a','/a',{branch:'other'}),schema),undefined);
 cache.set(a,{name:42});assert.equal(cache.get(a,schema),undefined);
 assert.equal(new ViewCache({getItem:()=>'{invalid',setItem:()=>{}}).get(a,schema),undefined);
 assert.equal(new ViewCache({getItem:()=>JSON.stringify({version:99,entries:[]}),setItem:()=>{}}).get(a,schema),undefined);
});
test('read refreshes deduplicate in-flight work and save completion after a view leaves',async()=>{
 const disk=storage(),cache=new ViewCache(disk);let calls=0,resolve!:(value:{name:string})=>void;
 const request=()=>{calls++;return new Promise<{name:string}>(r=>{resolve=r;});};
 const first=cache.load('read',request),second=cache.load('read',request);assert.equal(first,second);await Promise.resolve();assert.equal(calls,1);
 resolve({name:'loaded'});await first;assert.equal(new ViewCache(disk).get('read',schema)?.value.name,'loaded');
 await cache.load('read',async()=>({name:'updated'}));assert.equal(cache.get('read',schema)?.value.name,'updated');
 await assert.rejects(cache.load('read',async()=>{throw Error('offline');}),/offline/);assert.equal(cache.get('read',schema)?.value.name,'updated');
});
test('invalidating during a write prevents an older pending read from repopulating the saved view',async()=>{
 const cache=new ViewCache();let resolve!:(value:{name:string})=>void;
 const old=cache.load('repo:a',()=>new Promise<{name:string}>(r=>{resolve=r;}));await Promise.resolve();
 cache.invalidate(key=>key==='repo:a');await cache.load('repo:a',async()=>({name:'after mutation'}));
 resolve({name:'before mutation'});await old;assert.equal(cache.get('repo:a',schema)?.value.name,'after mutation');
});
test('cache bounds and storage failures preserve memory behavior without poisoning later reads',()=>{
 const disk=storage(),cache=new ViewCache(disk);
 for(let i=0;i<70;i++)cache.set(String(i),{name:'x'.repeat(30000)});
 assert.ok([...disk.values.values()][0].length*2<=2_000_000);assert.equal(cache.get('0',schema),undefined);assert.ok(cache.get('69',schema));
 cache.set('oversized',{name:'x'.repeat(1_100_000)});assert.equal(cache.get('oversized',schema),undefined);
 const blocked=new ViewCache({getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('quota');}});blocked.set('read',{name:'available'});assert.equal(blocked.get('read',schema)?.value.name,'available');
});
test('partial discovery retains last-seen identities without claiming completeness or keeping stale clone actions',()=>{
 const old={repositories:[{id:'repo:a',name:'same',path:'/a',hostId:'one'}],setupCandidates:[{id:'setup:old',projectId:'p',projectName:'P',hostId:'one',hostName:'One',name:'old',state:'missing' as const,action:'clone' as const}],complete:true,warnings:[]};
 const partial={repositories:[{id:'repo:b',name:'same',path:'/b',hostId:'two'}],setupCandidates:[],complete:false,warnings:['One is offline']};
 const merged=retainCatalog(partial,old);assert.deepEqual(merged.repositories.map(r=>r.id),['repo:b','repo:a']);assert.equal(merged.complete,false);assert.deepEqual(merged.warnings,partial.warnings);assert.deepEqual(merged.setupCandidates,[]);
 const disk=storage(),cache=new ViewCache(disk);cache.set('catalog',merged);assert.equal(new ViewCache(disk).get('catalog',catalogSchema)?.value.repositories[1].path,'/a');
 assert.deepEqual(retainCatalog({...partial,complete:true,repositories:[]},old).repositories,[]);
 assert.equal(retainCatalog({...partial,repositories:[{...old.repositories[0],path:'/new'}]},old).repositories[0].path,'/new');
});
