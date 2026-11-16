import { z } from 'zod';
import { commitSchema, querySchema, readSchema, type catalogSchema } from './read-contract';

type Entry<T> = { value:T; updatedAt:number };
const storageKey='bb.git-workbench.views.v1';
const maxBytes=2_000_000, maxEntries=48;
const envelope=z.object({version:z.literal(1),entries:z.array(z.tuple([z.string().max(16000),z.object({value:z.unknown(),updatedAt:z.number().finite().nonnegative()})])).max(maxEntries)});
export const cacheKey=(kind:string,...scope:unknown[])=>JSON.stringify([kind,...scope]);
export function retainCatalog(current:z.infer<typeof catalogSchema>,previous?:z.infer<typeof catalogSchema>){
 if(current.complete||!previous)return current;
 const ids=new Set(current.repositories.map(r=>r.id));
 return {...current,repositories:[...current.repositories,...previous.repositories.filter(r=>!ids.has(r.id))]};
}

/** Read-only display cache. Pending requests survive view unmounts; writes never use it. */
export class ViewCache {
 private entries=new Map<string,Entry<unknown>>();
 private pending=new Map<string,Promise<unknown>>();
 private revision=0;
 private parsed=new WeakMap<Entry<unknown>,Map<object,unknown>>();
 constructor(private storage?:Pick<Storage,'getItem'|'setItem'>){
  try{const text=storage?.getItem(storageKey);if(text&&text.length*2<=maxBytes){const parsed=envelope.safeParse(JSON.parse(text));if(parsed.success)this.entries=new Map(parsed.data.entries);}}catch{/* An unavailable or corrupt cache behaves like a first visit. */}
 }
 get<T>(key:string,schema:z.ZodType<T>):Entry<T>|undefined{
  const entry=this.entries.get(key);if(!entry)return;
  const known=this.parsed.get(entry);if(known?.has(schema))return {value:known.get(schema) as T,updatedAt:entry.updatedAt};
  const parsed=schema.safeParse(entry.value);if(!parsed.success){this.entries.delete(key);return;}
  const values=known||new Map();values.set(schema,parsed.data);this.parsed.set(entry,values);
  return {value:parsed.data,updatedAt:entry.updatedAt};
 }
 set(key:string,value:unknown){
  const entry={value,updatedAt:Date.now()};
  try{if(JSON.stringify([key,entry]).length*2>maxBytes/2)return;}catch{return;}
  this.entries.delete(key);this.entries.set(key,entry);
  while(this.entries.size>maxEntries)this.entries.delete(this.entries.keys().next().value!);
  this.persist();
 }
 load<T>(key:string,request:()=>Promise<T>):Promise<T>{
  const pending=this.pending.get(key);if(pending)return pending as Promise<T>;
  const revision=this.revision;
  const promise=Promise.resolve().then(request).then(value=>{if(revision===this.revision)this.set(key,value);return value;});
  this.pending.set(key,promise);
  const clear=()=>{if(this.pending.get(key)===promise)this.pending.delete(key);};
  promise.then(clear,clear);return promise;
 }
 invalidate(match:(key:string)=>boolean){
  this.revision++;
  for(const key of this.entries.keys())if(match(key))this.entries.delete(key);
  for(const key of this.pending.keys())if(match(key))this.pending.delete(key);
  this.persist();
 }
 private persist(){
  try{
   let text=JSON.stringify({version:1,entries:[...this.entries]});
   while(text.length*2>maxBytes&&this.entries.size){this.entries.delete(this.entries.keys().next().value!);text=JSON.stringify({version:1,entries:[...this.entries]});}
   this.storage?.setItem(storageKey,text);
  }catch{/* Memory still serves the last successful response when storage is full. */}
 }
}
const stores=new WeakMap<object,ViewCache>();
export function viewCache(){
 const realm=globalThis.window||globalThis;let store=stores.get(realm);
 if(!store){let storage:Storage|undefined;try{storage=globalThis.window?.sessionStorage;}catch{}store=new ViewCache(storage);stores.set(realm,store);}
 return store;
}
export const workbenchViewSchema=z.object({repo:z.string(),projectId:z.string(),worktreePath:z.string(),query:querySchema,tab:z.enum(['Log','Pull requests','Worktrees','Stash','Remotes','Console']),file:z.string(),staged:z.boolean(),commit:commitSchema.nullable(),commitPath:z.string(),detail:readSchema.nullable(),view:z.enum(['unified','split']),ignoreWhitespace:z.boolean()});
export const prViewSchema=z.object({listPage:z.number().int().min(1).max(100),filter:z.enum(['open','closed','merged','all']),search:z.string().max(200),number:z.number().int().nonnegative(),section:z.enum(['files','threads','comments','commits','checks','review']),file:z.string(),split:z.boolean(),unresolved:z.boolean(),viewed:z.record(z.string(),z.boolean())});
export const syncTime=(time:number)=>new Date(time).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
