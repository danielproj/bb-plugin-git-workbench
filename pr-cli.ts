import { spawn } from 'node:child_process';
export type Transport=(cwd:string,args:string[],body?:unknown,signal?:AbortSignal)=>Promise<string>;
export const gh:Transport=(cwd,args,body,signal)=>new Promise((resolve,reject)=>{
 const child=spawn('gh',args,{cwd,signal,env:{...process.env,GH_PROMPT_DISABLED:'1',GH_PAGER:'cat'},stdio:['pipe','pipe','pipe']});
 let out='',err='',size=0,failed=false;
 const timer=setTimeout(()=>{failed=true;child.kill();reject(Error('GITHUB_TIMEOUT: Request timed out; refresh before retrying a write.'));},45000);
 const collect=(chunk:Buffer,isError:boolean)=>{size+=chunk.length;if(size>2000000){failed=true;child.kill();reject(Error('GITHUB_OUTPUT_LIMIT: Response exceeds safe bounds.'));}else if(isError)err+=chunk;else out+=chunk;};
 child.stdout.on('data',c=>collect(c,false));child.stderr.on('data',c=>collect(c,true));
 child.on('error',e=>{clearTimeout(timer);reject(Error((e as NodeJS.ErrnoException).code==='ENOENT'?'GH_MISSING: Install GitHub CLI on the repository host.':e.message));});
 child.on('close',code=>{clearTimeout(timer);if(failed)return;if(code===0)resolve(out);else reject(Error(`${code===4?'GH_AUTH':/403|Resource not accessible/.test(err)?'GH_PERMISSION':'GH_ERROR'}: ${err.slice(0,2000)}`));});
 child.stdin.on('error',()=>{});child.stdin.end(body===undefined?undefined:JSON.stringify(body));
});
