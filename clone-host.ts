import {lstat,mkdir,mkdtemp,rename,rm,rmdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {git} from './git';
import {gitIdentity,type GitIdentity} from './catalog-host';
import {normalizeRemote} from './clone-contract';

export const cloneDirectory=()=>({directory:path.join(homedir(),'Projects')});
export async function verifyClone(identity:GitIdentity,remoteUrl:string,signal?:AbortSignal){
 const actual=await gitIdentity(identity.root,signal);
 if(actual.root!==identity.root||actual.commonDir!==identity.commonDir||actual.incarnation!==identity.incarnation)throw Error('The cloned repository changed. Its files have been preserved.');
 if((await git(actual.root,['config','--get','remote.origin.url'],signal)).trim()!==normalizeRemote(remoteUrl))throw Error('The cloned repository’s origin changed. Its files have been preserved.');
 return actual;
}
export async function cloneRepository(directory:string,remoteUrl:string,signal?:AbortSignal,run=git):Promise<GitIdentity>{
 const remote=normalizeRemote(remoteUrl);
 if(!path.isAbsolute(directory))throw Error('Destination must be an absolute path on this machine.');
 const destination=path.resolve(directory);
 if(destination===path.parse(destination).root||destination.split(/[\\/]/).some(part=>part.replace(/[. ]+$/,'').toLowerCase()==='.git'))throw Error('Choose a new checkout directory outside Git metadata.');
 signal?.throwIfAborted();
 try{await lstat(destination);throw Error('The destination already exists. Choose a new directory; its contents have been preserved.');}
 catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const parent=path.dirname(destination);
 await mkdir(parent,{recursive:true});
 const staging=await mkdtemp(path.join(parent,'.gw-clone-'));
 let reserved=false;
 try{
  const temporary=path.join(staging,'repository');
  await run(parent,['clone','--origin','origin','--quiet','--',remote,temporary],signal,undefined,false,300000);
  signal?.throwIfAborted();
  // Check the remote before promoting, then reserve the destination exclusively.
  if((await run(temporary,['config','--get','remote.origin.url'],signal)).trim()!==remote)throw Error('The clone did not retain the requested origin.');
  signal?.throwIfAborted();
  await mkdir(destination);reserved=true;
  signal?.throwIfAborted();
  await rename(temporary,destination);reserved=false;
  return await gitIdentity(await realpath(destination),signal);
 }finally{
  if(reserved)await rmdir(destination).catch(()=>{});
  await rm(staging,{recursive:true,force:true});
 }
}
