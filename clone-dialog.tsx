import {useEffect,useRef,useState} from 'react';
import {cloneRequest,repositoryName,checkoutPath,type CloneRequest,type CloneJob,type CloneOptions} from './clone-contract';
import type {Repository} from './contract';
import {Icon} from './components/ui/icon';
export type CloneApi={options:()=>Promise<CloneOptions>;start:(input:CloneRequest)=>Promise<CloneJob>;status:(id:string)=>Promise<CloneJob>};
export type CloneActivity='idle'|'working'|'ready'|'attention';
const storageKey='bb.git-workbench.clone-job';
function savedJob(){try{const id=window.sessionStorage.getItem(storageKey);return id&&cloneRequest.shape.id.safeParse(id).success?id:'';}catch{return '';}}
function rememberJob(id:string){try{if(id)window.sessionStorage.setItem(storageKey,id);else window.sessionStorage.removeItem(storageKey);}catch{}}

export function CloneRepositoryDialog({api,open,onClose,onOpen,onActivityChange,preferredHostId,canOpen=true,disabled=false}:{api:CloneApi;open:boolean;onClose:()=>void;onOpen:(repo:Repository,projectId:string)=>void;onActivityChange:(activity:CloneActivity)=>void;preferredHostId?:string;canOpen?:boolean;disabled?:boolean}){
 const [options,setOptions]=useState<CloneOptions>({hosts:[],warnings:[]}),[loading,setLoading]=useState(false);
 const [remote,setRemote]=useState(''),[name,setName]=useState(''),[hostId,setHostId]=useState(''),[path,setPath]=useState('');
 const [jobId,setJobId]=useState(savedJob),[job,setJob]=useState<CloneJob|null>(null),[revision,setRevision]=useState(0);
 const [error,setError]=useState(''),[statusError,setStatusError]=useState(''),[requesting,setRequesting]=useState(false);
 const nameEdited=useRef(false),pathEdited=useRef(false),inFlight=useRef(false),mounted=useRef(true),opened=useRef('');
 const working=!!jobId&&job?.status!=='ready'&&job?.status!=='failed';
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const activity:CloneActivity=error||statusError||job?.status==='failed'?'attention':working||requesting?'working':job?.status==='ready'?'ready':'idle';
 useEffect(()=>{onActivityChange(activity);},[activity,onActivityChange]);
 const onOpenRef=useRef(onOpen),onCloseRef=useRef(onClose);onOpenRef.current=onOpen;onCloseRef.current=onClose;
 useEffect(()=>{
  if(!open)return;let live=true;setLoading(true);
  api.options().then(value=>{if(!live)return;setOptions(value);setHostId(current=>current||value.hosts.find(h=>h.id===preferredHostId)?.id||value.hosts[0]?.id||'');}).catch(e=>{if(live)setError(String(e));}).finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};
 },[api,open,preferredHostId]);
 useEffect(()=>{if(!pathEdited.current&&!jobId){const directory=options.hosts.find(h=>h.id===hostId)?.directory;if(directory)setPath(checkoutPath(directory,repositoryName(remote)));}},[options,hostId,remote,jobId]);
 useEffect(()=>{
  if(!jobId||requesting)return;let live=true,timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{
   let delay=1000;
   try{const value=await api.status(jobId);if(!live)return;setJob(value);setStatusError('');if(['ready','failed'].includes(value.status))return;}
   catch(e){if(!live)return;setStatusError(String(e));if(String(e).includes('Clone status is no longer available'))return;delay=3000;}
   if(live)timer=setTimeout(()=>void poll(),delay);
  };
  void poll();return()=>{live=false;clearTimeout(timer);};
 },[api,jobId,revision,requesting]);
 useEffect(()=>{
  if(!job)return;setRemote(job.remoteUrl);setName(job.name);setHostId(job.hostId);setPath(job.path);
 },[job?.id]);
 useEffect(()=>{
  if(!open||!job||job.status!=='ready'||!job.repository||!job.projectId||!canOpen||opened.current===job.id)return;
  opened.current=job.id;
  onOpenRef.current(job.repository,job.projectId);rememberJob('');setJobId('');setJob(null);onCloseRef.current();
  nameEdited.current=false;pathEdited.current=false;setRemote('');setName('');setPath('');
 },[job,canOpen,open]);
 function reset(){rememberJob('');setJobId('');setJob(null);setError('');setStatusError('');setRevision(v=>v+1);opened.current='';}
 async function start(retry=false){
  if(inFlight.current||disabled)return;
  const parsed=cloneRequest.safeParse({id:job?.id||jobId||crypto.randomUUID(),hostId,remoteUrl:remote,path,name,confirmed:true,retry});
  if(!parsed.success){setError(parsed.error.issues[0]?.message||'Check the clone fields.');return;}
  inFlight.current=true;setRequesting(true);setError('');setStatusError('');rememberJob(parsed.data.id);setJobId(parsed.data.id);
  try{const value=await api.start(parsed.data);if(mounted.current){setJobId(value.id);rememberJob(value.id);setJob(value);setRevision(v=>v+1);}}
  catch(e){if(mounted.current)setError(`${String(e)}. Check progress before starting another clone if the connection was interrupted.`);}
  finally{inFlight.current=false;if(mounted.current)setRequesting(false);}
 }
 if(!open)return null;
 const locked=!!jobId||requesting;
 return <div className="gw-overlay"><form className="gw-dialog pr-action-dialog pr-confirm-review gw-clone-dialog" role="dialog" aria-modal="true" aria-label="Clone repository" onSubmit={e=>{e.preventDefault();void start();}}>
  <header className="pr-dialog-heading"><span className="pr-dialog-icon"><Icon name="Download" className="gw-icon"/></span><div><small>New repository</small><h3>Clone repository</h3></div></header>
  <p className="gw-clone-intro">Check out a remote repository and open it in Workbench. It will be registered as a new BB project on the selected machine.</p>
  <label>Repository URL<input aria-label="Repository URL" type="text" placeholder="https://github.com/owner/repository.git" autoFocus value={remote} disabled={locked} onChange={e=>{setRemote(e.target.value);if(!nameEdited.current)setName(repositoryName(e.target.value));}}/></label>
  <div className="gw-clone-fields"><label>Project name<input aria-label="Project name" value={name} disabled={locked} onChange={e=>{nameEdited.current=true;setName(e.target.value);}}/></label><label>Machine<select aria-label="Clone machine" value={hostId} disabled={locked||loading} onChange={e=>{setHostId(e.target.value);pathEdited.current=false;}}><option value="">{loading?'Loading machines…':'Choose a machine'}</option>{hostId&&!options.hosts.some(h=>h.id===hostId)&&<option value={hostId} disabled>Selected machine unavailable</option>}{options.hosts.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</select></label></div>
  <label>Destination folder<input aria-label="Destination folder" value={path} disabled={locked} placeholder="/absolute/path/to/new-checkout" onChange={e=>{pathEdited.current=true;setPath(e.target.value);}}/><small>The folder must not exist. Existing files and repositories are preserved.</small></label>
  <p className="gw-clone-note">Uses this machine’s existing Git credentials. The repository’s default branch is checked out.</p>
  {!loading&&!options.hosts.length&&!locked&&<p role="status">Connect a persistent machine to BB, then reopen this dialog.</p>}
  {!!options.warnings.length&&<details className="gw-clone-notices"><summary>Machine notices</summary>{options.warnings.map(w=><p key={w}>{w}</p>)}</details>}
  {job&&<div className={`gw-clone-progress ${job.status==='failed'?'gw-clone-failed':''}`} role={job.status==='failed'?'alert':'status'}><strong>{job.status==='cloning'?'Cloning repository…':job.status==='registering'?'Registering project…':job.status==='ready'?'Repository ready':'Clone needs attention'}</strong><p>{job.message}</p>{job.status==='ready'&&!canOpen&&<p>Finish the current Git action or save your commit draft to open the new checkout.</p>}</div>}
  {error&&<p className="gw-clone-error" role="alert">{error}</p>}{statusError&&<p className="gw-clone-error" role="alert">{statusError}</p>}
  <div className="gw-dialog-actions"><button className="gw-secondary" type="button" onClick={onClose}>{working?'Close':'Cancel'}</button>
   {job?.status==='failed'?<><button type="button" className="gw-secondary" onClick={reset}>New request</button><button type="button" className="pr-primary" disabled={requesting||disabled} onClick={()=>void start(true)}>{job.checkoutCreated?'Retry registration':'Retry clone'}</button></>:!locked?<button className="pr-primary" type="submit" disabled={disabled||loading||!hostId||!remote.trim()||!path.trim()||!name.trim()}>Clone and open</button>:statusError||error?<><button type="button" className="gw-secondary" onClick={reset}>New request</button><button type="button" className="pr-primary" onClick={()=>setRevision(v=>v+1)}>Check progress</button></>:<button type="button" className="pr-primary" disabled>{job?.status==='ready'?'Ready to open':'Cloning…'}</button>}
  </div>{working&&<small className="gw-clone-background">Cloning continues if you close this dialog. Reopen it to check progress.</small>}
 </form></div>;
}
