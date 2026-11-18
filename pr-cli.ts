import { spawn } from 'node:child_process';
import { maxImageBytes } from './pr-image-source';
export type Transport=(cwd:string,args:string[],body?:unknown,signal?:AbortSignal)=>Promise<string>;
export const gh:Transport=async(cwd,args,body,signal)=>(await runGh(cwd,args,2000000,body,signal)).toString();
export function ghImage(cwd:string,args:string[],signal?:AbortSignal){
 return runGh(cwd,args,maxImageBytes,undefined,signal);
}
function runGh(cwd:string,args:string[],limit:number,body?:unknown,signal?:AbortSignal):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
 const child=spawn('gh',args,{cwd,signal,env:{...process.env,GH_PROMPT_DISABLED:'1',GH_PAGER:'cat'},stdio:['pipe','pipe','pipe']});
 const out:Buffer[]=[];
 let err='',size=0,errorSize=0,failed=false;
 const timer=setTimeout(()=>{failed=true;child.kill();reject(Error('GITHUB_TIMEOUT: Request timed out; refresh before retrying a write.'));},45000);
 child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>limit){failed=true;child.kill();reject(Error('GITHUB_OUTPUT_LIMIT: Response exceeds safe bounds.'));}else out.push(chunk);});
 child.stderr.on('data',(chunk:Buffer)=>{if(errorSize<2000)err+=chunk.subarray(0,2000-errorSize).toString();errorSize+=chunk.length;});
 child.on('error',e=>{clearTimeout(timer);reject(Error((e as NodeJS.ErrnoException).code==='ENOENT'?'GH_MISSING: Install GitHub CLI on the repository host.':e.message));});
 child.on('close',code=>{clearTimeout(timer);if(failed)return;if(code===0)resolve(Buffer.concat(out,size));else reject(Error(`${code===4?'GH_AUTH':/403|Resource not accessible/.test(err)?'GH_PERMISSION':'GH_ERROR'}: ${err}`));});
 child.stdin.on('error',()=>{});child.stdin.end(body===undefined?undefined:JSON.stringify(body));
 });
}
