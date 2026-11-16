import { Markdown } from '@get-bb/plugin-sdk/app';
import type { PrResult } from './pr-contract';

export function checkState(status:string|null|undefined,conclusion?:string|null){
 const state=(conclusion||status||'unknown').toLowerCase();
 if(state==='success')return {label:'Passed',tone:'good',icon:'✓',group:'Passed'};
 if(['failure','error','timed_out','action_required'].includes(state))return {label:state==='timed_out'?'Timed out':state==='action_required'?'Action required':'Failed',tone:'bad',icon:'!',group:'Needs attention'};
 if(['pending','queued','in_progress','waiting','requested'].includes(state))return {label:state==='in_progress'?'Running':state==='queued'?'Queued':'Pending',tone:'warn',icon:'◷',group:'In progress'};
 if(['skipped','neutral','cancelled','stale'].includes(state))return {label:state[0].toUpperCase()+state.slice(1),tone:'neutral',icon:'−',group:'Skipped & other'};
 return {label:'Unknown',tone:'neutral',icon:'?',group:'Skipped & other'};
}
export function duration(start?:string|null,end?:string|null){
 if(!start||!end)return null;
 const seconds=Math.round((Date.parse(end)-Date.parse(start))/1000);
 if(!Number.isFinite(seconds)||seconds<0)return null;
 if(seconds<60)return `${seconds}s`;
 if(seconds<3600)return `${Math.floor(seconds/60)}m ${seconds%60}s`;
 return `${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m`;
}
export function webUrl(value?:string|null){
 try{const u=new URL(value||'');return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:undefined;}catch{return undefined;}
}
function Timestamp({value,label}:{value?:string|null;label:string}){
 if(!value||!Number.isFinite(Date.parse(value)))return null;
 return <time dateTime={value} title={`${label}: ${new Date(value).toLocaleString()}`}>{label} {new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time>;
}
type Check=NonNullable<PrResult['checks']>['checkRuns'][number];
export function Checks({result,head,canAct,onReadRun,onAction}:{result?:PrResult;head:string;canAct:boolean;onReadRun:(kind:'jobs'|'logs',id:number)=>void;onAction:(action:'rerun'|'cancel',id:number)=>void}){
 const checks=result?.checks,contexts=checks?.contexts||[],runs=result?.runs||[];
 const cards=(checks?.checkRuns||[]).map(c=>({check:c,state:checkState(c.status,c.conclusion)}));
 const statuses=(checks?.statuses||[]).map(c=>({status:c,state:checkState(c.state)}));
 const all=[...cards,...statuses],groups=['Needs attention','In progress','Passed','Skipped & other'];
 const represented=new Set([...(checks?.checkRuns||[]).map(c=>`CheckRun:${c.name}`),...(checks?.statuses||[]).map(c=>`StatusContext:${c.context}`)]);
 const unrepresented=contexts.filter(c=>!represented.has(`${c.__typename}:${c.name||c.context}`));
 const fresh=checks?.head===head;
 function requirement(name:string,kind:string){const matches=contexts.filter(c=>c.__typename===kind&&(c.name||c.context)===name);return matches.length===1?(matches[0].isRequired?'Required':'Optional'):'Requirement unknown';}
 function checkCard(c:Check,state:ReturnType<typeof checkState>){
  const href=webUrl(c.details_url),elapsed=duration(c.started_at,c.completed_at);
  const run=runs.find(r=>{try{return r.head_sha===head&&new URL(href||'').pathname.includes(`/actions/runs/${r.id}/`);}catch{return false;}});
  const body=<><span className="pr-check-icon" aria-hidden="true">{state.icon}</span><span className="pr-check-identity"><strong>{c.name}</strong><span className="pr-check-meta"><span>{requirement(c.name,'CheckRun')}</span>{c.app?.name&&<span>{c.app.name}</span>}{run?.name&&<span>{run.name}</span>}{elapsed&&<span>{elapsed}</span>}<Timestamp value={c.completed_at||c.started_at} label={c.completed_at?'Finished':'Started'}/></span></span><span className="pr-check-badge">{state.label}</span>{href&&<span className="pr-check-external" aria-hidden="true">↗</span>}</>;
  return <article key={`check:${c.id}`} className="pr-check-card" data-tone={state.tone}>
   {href?<a className="pr-check-link" href={href} target="_blank" rel="noreferrer" aria-label={`${c.name} · ${state.label} · Open check externally`}>{body}</a>:<div className="pr-check-link">{body}</div>}
   {(c.output.title||c.output.summary||c.output.text)&&<details className="pr-check-output"><summary>{c.output.title||'Check output'}<span>Details</span></summary><div>{c.output.summary&&<Markdown className="pr-markdown" content={c.output.summary}/>} {c.output.text&&<Markdown className="pr-markdown" content={c.output.text}/>}</div></details>}
  </article>;
 }
 return <section className="pr-checks" aria-label="Checks and workflows">
  <header className="pr-checks-heading"><div><h3>Checks & workflows</h3><p>Reported for <code>{head.slice(0,12)}</code>{checks&&!fresh?' · Results belong to another head':''}</p></div><span className="pr-checks-count">{all.length} reported</span></header>
  <div className="pr-check-metrics">{[{label:'Passed',tone:'good',count:all.filter(c=>c.state.tone==='good').length},{label:'Attention',tone:'bad',count:all.filter(c=>c.state.tone==='bad').length},{label:'In progress',tone:'warn',count:all.filter(c=>c.state.tone==='warn').length},{label:'Other',tone:'neutral',count:all.filter(c=>c.state.tone==='neutral').length}].map(x=><div key={x.label} data-tone={x.tone}><strong>{x.count}</strong><span>{x.label}</span></div>)}</div>
  <p className="pr-check-coverage">{checks?.requiredCoverage==='complete'?'Required check classification complete':'Required check classification unknown'} · {result?.coverageComplete?'Complete check coverage':'Coverage may be incomplete'}. {canAct&&fresh?'Links open in your browser.':'Showing last available results.'}</p>
  {!checks&&<p className="pr-muted-note">Loading checks…</p>}
  {checks&&!all.length&&<p className="pr-muted-note">{unrepresented.length?'No detailed check runs reported. Additional requirement contexts appear below.':'No checks reported. This does not establish merge readiness.'}</p>}
  {groups.map(group=>{
   const matched=cards.filter(c=>c.state.group===group),legacy=statuses.filter(c=>c.state.group===group);
   return matched.length||legacy.length?<section className="pr-check-group" key={group}><h4>{group}<span>{matched.length+legacy.length}</span></h4><div>{matched.map(c=>checkCard(c.check,c.state))}{legacy.map(({status:c,state})=>{const href=webUrl(c.target_url);const body=<><span className="pr-check-icon" aria-hidden="true">{state.icon}</span><span className="pr-check-identity"><strong>{c.context}</strong><span className="pr-check-meta"><span>{requirement(c.context,'StatusContext')}</span><span>Commit status</span><Timestamp value={c.updated_at||c.created_at} label="Updated"/></span>{c.description&&<span className="pr-check-description">{c.description}</span>}</span><span className="pr-check-badge">{state.label}</span>{href&&<span className="pr-check-external" aria-hidden="true">↗</span>}</>;return <article className="pr-check-card" data-tone={state.tone} key={`status:${c.id}`}>{href?<a className="pr-check-link" href={href} target="_blank" rel="noreferrer" aria-label={`${c.context} · ${state.label} · Open status externally`}>{body}</a>:<div className="pr-check-link">{body}</div>}</article>;})}</div></section>:null;
  })}
  {!!unrepresented.length&&<details className="pr-extra-contexts"><summary>{unrepresented.length} additional requirement {unrepresented.length===1?'context':'contexts'}</summary>{unrepresented.map((c,i)=><p key={i}><strong>{c.name||c.context||'Unnamed context'}</strong> · {c.isRequired?'required':'optional'} · {c.conclusion||c.state||c.status||'unknown'}</p>)}</details>}
  {!!runs.length&&<section className="pr-workflow-group"><h4>Workflow runs<span>{runs.length}</span></h4>{result?.runsCoverageComplete!==true&&<p className="pr-check-coverage">Showing a bounded run list; more workflows may exist on GitHub.</p>}{runs.map(r=>{const state=checkState(r.status,r.conclusion),href=webUrl(r.html_url),sameHead=r.head_sha===head;return <article className="pr-check-card pr-workflow" data-tone={state.tone} key={r.id}><a className="pr-check-link" href={href} target="_blank" rel="noreferrer"><span className="pr-check-icon" aria-hidden="true">{state.icon}</span><span className="pr-check-identity"><strong>{r.name||'Workflow run'}{r.run_number&&<small> #{r.run_number}</small>}</strong><span className="pr-check-meta">{r.event&&<span>{r.event.replaceAll('_',' ')}</span>}{r.head_branch&&<span>{r.head_branch}</span>}{r.run_attempt&&<span>Attempt {r.run_attempt}</span>}<Timestamp value={r.run_started_at||r.created_at} label="Started"/>{!sameHead&&<span>Different head</span>}</span></span><span className="pr-check-badge">{state.label}</span>{href&&<span className="pr-check-external" aria-hidden="true">↗</span>}</a><div className="pr-workflow-actions"><button disabled={!sameHead} onClick={()=>onReadRun('jobs',r.id)}>Jobs</button><button disabled={!sameHead} onClick={()=>onReadRun('logs',r.id)}>Failed logs</button>{['completed','cancelled'].includes(r.status||'')?<button className="gw-action-warn" disabled={!sameHead||!canAct} onClick={()=>onAction('rerun',r.id)}>Rerun failed…</button>:<button className="gw-action-danger" disabled={!sameHead||!canAct} onClick={()=>onAction('cancel',r.id)}>Cancel run…</button>}</div></article>;})}</section>}
 </section>;
}
