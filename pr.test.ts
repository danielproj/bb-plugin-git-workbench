import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPrService,validLine} from './pr-service';
import {bounded,mergeReadiness,repositoryFromRemote} from './pr-provider';
import {prMutation,prResult} from './pr-contract';
import {readPrImage} from './pr-image-host';
import {maxImageBytes,prImageUrl} from './pr-image-source';
const head='a'.repeat(40),p={number:1,title:'Test',body:'',state:'open',html_url:'https://github.com/o/r/pull/1',url:'https://api.github.com/repos/o/r/pulls/1',issue_url:'https://api.github.com/repos/o/r/issues/1',draft:false,head:{sha:head,label:'o:branch'},base:{ref:'main'},user:{login:'author'},mergeable:true,mergeable_state:'clean'};
function service(extra:(args:string[],body:any)=>any=()=>({})){const calls:any[]=[];const s=createPrService(async(_cwd,args,body)=>{calls.push({args,body});if(args[1]==='repos/o/r/pulls/1')return JSON.stringify(p);return JSON.stringify(extra(args,body));},async()=> 'git@github.com:o/r.git');return {s,calls};}
test('remote normalization rejects arbitrary hosts and shell strings',()=>{assert.equal(repositoryFromRemote('https://github.com/o/r.git'),'o/r');assert.throws(()=>repositoryFromRemote('https://evil/o/r'));assert.throws(()=>repositoryFromRemote('$(id)'));});
test('PR images use the authenticated GitHub contents API scoped to the selected repository', async () => {
 const runGit = async () => 'git@github.com:o/r.git';
 const jpeg = Buffer.from('ffd8ff000180', 'hex');
 const source = prImageUrl(`/o/r/raw/${head}/docs/a%20b.jpg`, p.html_url, head)!;
 const result = await readPrImage('.', source, undefined, runGit, async (_cwd, args) => {
  assert.deepEqual(args, ['api', '--hostname', 'github.com', '--method', 'GET',
   `repos/o/r/contents/docs/a%20b.jpg?ref=${head}`, '-H', 'Accept: application/vnd.github.raw']);
  return jpeg;
 });
 assert.deepEqual(result, {mime:'image/jpeg',base64:jpeg.toString('base64')});
 for (const url of [
  `https://github.com/other/r/raw/${head}/image.jpg`,
  `https://github.com.evil.example/o/r/raw/${head}/image.jpg`,
  `https://github.com/o/r/raw/${head}/docs%2fimage.jpg`,
 ]) {
  await assert.rejects(readPrImage('.', url, undefined, runGit, async () => {
   assert.fail('Unsupported destination reached authenticated transport');
  }), /selected GitHub repository/);
 }
 const oversized = Buffer.alloc(maxImageBytes + 1);
 jpeg.copy(oversized);
 for (const invalid of [Buffer.from('<svg/>'), oversized]) {
  await assert.rejects(readPrImage('.', source, undefined, runGit, async () => invalid), /Unsupported image/);
 }
});
test('readiness fails closed for draft conflicts unknown and protected',()=>{assert.equal(mergeReadiness(p),null);for(const change of [{draft:true},{mergeable:null},{mergeable:false},{mergeable_state:'blocked'},{state:'closed'}])assert.ok(mergeReadiness({...p,...change}));});
test('pagination never makes an incomplete set complete',()=>{assert.equal(bounded(Array(50).fill({})).coverageComplete,false);assert.equal(bounded([],2).coverageComplete,false);assert.equal(bounded([]).coverageComplete,true);});
test('stale head rejects all writes before transport mutation',async()=>{const {s,calls}=service();await assert.rejects(s.mutate('.',prMutation.parse({action:'comment',confirmed:true,number:1,expectedHead:'b'.repeat(40),body:'hi'})),/STALE_HEAD/);assert.equal(calls.length,1);});
test('review pins commit even if remote advances during write; drafts untouched',async()=>{const comments=[{path:'a',line:2,side:'RIGHT',body:'suggestion'}];const {s,calls}=service((args,body)=>{if(args[1].includes('/files?'))return [{filename:'a',patch:'@@ -1 +1,2 @@\n old\n+new'}];if(args[1].endsWith('/reviews')){assert.equal(body.commit_id,head);throw Error('head advanced');}return {};});await assert.rejects(s.mutate('.',prMutation.parse({action:'review',confirmed:true,number:1,expectedHead:head,event:'COMMENT',comments})),/head advanced/);assert.equal(comments.length,1);assert.equal(calls.filter(c=>c.args[1].endsWith('/reviews')).length,1);});
test('inline line checks respect added/deleted sides',()=>{const patch='@@ -4,2 +4,2 @@\n-old\n+new\n same';assert.equal(validLine(patch,4,'RIGHT'),true);assert.equal(validLine(patch,6,'RIGHT'),false);});
test('unrelated comments and CI runs are refused',async()=>{for(const op of [{action:'reply',id:'2',body:'x'},{action:'reaction',id:'2',reaction:'+1'},{action:'cancel',runId:2}]){const {s,calls}=service(()=>({pull_request_url:'other',issue_url:'other',head_sha:'other'}));await assert.rejects(s.mutate('.',prMutation.parse({...op,confirmed:true,number:1,expectedHead:head})),/SCOPE/);assert.equal(calls.length,2);}});
test('own approval checks root viewer endpoint',async()=>{const {s,calls}=service(args=>args[1]==='user'?{login:'author'}:{});await assert.rejects(s.mutate('.',prMutation.parse({action:'review',confirmed:true,number:1,expectedHead:head,event:'APPROVE'})),/own PR/);assert.ok(calls.some(c=>c.args[1]==='user'));});
test('merge sends SHA and strategy without bypass; unknown readiness blocks',async()=>{const {s,calls}=service((args,body)=>{if(args[1].endsWith('/merge')){assert.deepEqual(body,{sha:head,merge_method:'squash'});throw Error('write captured');}return {};});await assert.rejects(s.mutate('.',prMutation.parse({action:'merge',confirmed:true,number:1,expectedHead:head,strategy:'squash'})),/write captured/);assert.ok(calls.every(c=>!c.args.includes('--admin')));});
test('explicit confirmation required and output validates',()=>{assert.throws(()=>prMutation.parse({action:'comment',number:1,expectedHead:head,body:'x'}));assert.ok(prResult.parse(bounded([])));});
test('check states preserve required, optional and skipped; incomplete coverage stays unknown',async()=>{for(const incomplete of [false,true]){const {s}=service(args=>{if(args[1]==='graphql')return {data:{repository:{pullRequest:{commits:{nodes:[{commit:{oid:head,statusCheckRollup:{contexts:{nodes:[{__typename:'CheckRun',name:'required',status:'COMPLETED',conclusion:'SKIPPED',isRequired:true},{__typename:'StatusContext',context:'optional',state:'PENDING',isRequired:false}],pageInfo:{hasNextPage:incomplete}}}}}]}}}}};if(args[1].includes('/check-runs'))return {total_count:0,check_runs:[]};if(args[1].includes('/status?'))return {total_count:0,statuses:[]};return {workflow_runs:[]};});const result=prResult.parse(await s.read('.',{number:1,kind:'checks',page:1}));assert.equal(result.coverageComplete,!incomplete);assert.equal(result.checks?.requiredCoverage,incomplete?'unknown':'complete');assert.equal(result.checks?.contexts[0].conclusion,'SKIPPED');assert.equal(result.checks?.contexts[1].isRequired,false);}});
test('no PR is empty; permission and authentication errors are not empty',async()=>{const empty=service(()=>[]);assert.equal((await empty.s.list('.',{state:'open',search:'',page:1})).items.length,0);for(const code of ['GH_AUTH','GH_PERMISSION']){const {s}=service(()=>{throw Error(code);});await assert.rejects(s.list('.',{state:'open',search:'',page:1}),new RegExp(code));}});
test('review comment reaction removal validates scope then deletes only viewer reaction',async()=>{const {s,calls}=service(args=>{if(args[1]==='user')return {login:'me'};if(args[1].includes('/reactions?'))return [{id:9,content:'heart',user:{login:'me'}}];if(args[1].endsWith('/reactions/9'))throw Error('captured delete');return {pull_request_url:p.url};});await assert.rejects(s.mutate('.',prMutation.parse({action:'reaction',confirmed:true,number:1,expectedHead:head,id:'2',commentKind:'review',reaction:'heart',remove:true})),/captured delete/);assert.ok(calls.some(c=>c.args.includes('DELETE')));});
test('confirmed review write survives failed detail refresh with applied acknowledgement',async()=>{
 let reads=0,writes=0;
 const s=createPrService(async(_cwd,args)=>{
  if(args[1]==='repos/o/r/pulls/1'){if(++reads>1)throw Error('refresh unavailable');return JSON.stringify(p);}
  if(args[1].endsWith('/reviews')){writes++;return JSON.stringify({id:123});}
  throw Error('Unexpected request');
 },async()=> 'git@github.com:o/r.git');
 const result=await s.mutate('.',prMutation.parse({action:'review',confirmed:true,number:1,expectedHead:head,event:'COMMENT',body:'review'}));
 assert.equal(result.applied,true);assert.equal('refreshError' in result&&result.refreshError,'refresh unavailable');assert.equal('detail' in result,false);assert.equal(writes,1);
});
test('search refuses out-of-repository results even with scope qualifiers or OR',async()=>{
 for(const search of ['repo:other/repo','org:other','user:other','fix OR repo:other/repo']){
  const {s}=service(()=>({items:[{repository_url:'https://api.github.com/repos/other/repo'}],total_count:1,incomplete_results:false}));
  await assert.rejects(s.list('.',{state:'open',search,page:1}),/SEARCH_SCOPE/);
 }
 const {s}=service(()=>({items:[{repository_url:'https://api.github.com/repos/o/r'}],total_count:1,incomplete_results:false}));
 assert.equal((await s.list('.',{state:'open',search:'fix OR bug',page:1})).items.length,1);
});
test('worktree requires absolute path before fetch or local mutation',async()=>{
 for(const path of ['review','../review','sub/../../review']){
  const gitCalls:string[][]=[];
  const s=createPrService(async()=>JSON.stringify(p),async(_cwd,args)=>{gitCalls.push(args);return args[0]==='remote'?'git@github.com:o/r.git':'';});
  await assert.rejects(s.mutate('.',prMutation.parse({action:'worktree',confirmed:true,number:1,expectedHead:head,path})),/Invalid worktree path/);
  assert.ok(gitCalls.every(args=>!['fetch','worktree'].includes(args[0])));
 }
});
test('create acknowledges confirmed write and timeout remains uncertain',async()=>{
 const op=prMutation.parse({action:'create',confirmed:true,title:'new',body:'',base:'main',head:'branch',draft:true});
 const {s}=service(()=>p);assert.equal((await s.mutate('.',op)).applied,true);
 const timed=service(()=>{throw Error('GITHUB_TIMEOUT');});await assert.rejects(timed.s.mutate('.',op),/GITHUB_TIMEOUT/);
});
test('authoritative empty rollup is complete only on matching head with empty REST collections',async()=>{
 for(const [oid,count,expected] of [[head,0,true],['b'.repeat(40),0,false],[head,1,false]] as const){
 const {s}=service(args=>args[1]==='graphql'?{data:{repository:{pullRequest:{commits:{nodes:[{commit:{oid,statusCheckRollup:null}}]}}}}}:args[1].includes('/check-runs')?{total_count:count,check_runs:[]}:args[1].includes('/status?')?{total_count:0,statuses:[]}:{workflow_runs:[]});
 const r=prResult.parse(await s.read('.',{number:1,kind:'checks',page:1}));assert.equal(r.coverageComplete,expected);assert.equal(r.checks?.requiredCoverage,expected?'complete':'unknown');
 }
});
test('PR checkout preserves ignored local files that target commit would overwrite',async()=>{
 const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {git}=await import('./git');
 const dir=await mkdtemp(join(tmpdir(),'gw-checkout-'));
 try{await git(dir,['init']);await git(dir,['config','user.email','test@example.invalid']);await git(dir,['config','user.name','Test']);await writeFile(join(dir,'.gitignore'),'secret\n');await git(dir,['add','.gitignore']);await git(dir,['commit','-m','base']);const base=(await git(dir,['rev-parse','HEAD'])).trim();await writeFile(join(dir,'secret'),'remote');await git(dir,['add','-f','secret']);await git(dir,['commit','-m','target']);const target=(await git(dir,['rev-parse','HEAD'])).trim();await git(dir,['checkout','--detach',base]);await writeFile(join(dir,'secret'),'local precious');assert.equal((await git(dir,['status','--porcelain'])).trim(),'');
 const s=createPrService(async()=>JSON.stringify({...p,head:{...p.head,sha:target}}),async(cwd,args,signal)=>args[0]==='remote'?'https://github.com/o/r.git':args[0]==='fetch'?git(cwd,['update-ref','FETCH_HEAD',target],signal):git(cwd,args,signal));
 await assert.rejects(s.mutate(dir,prMutation.parse({action:'checkout',confirmed:true,number:1,expectedHead:target})));assert.equal(await readFile(join(dir,'secret'),'utf8'),'local precious');assert.equal((await git(dir,['rev-parse','HEAD'])).trim(),base);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('inbox normalizes bounded previews, merged state and stale or absent health',async()=>{
 const {inboxSummary}=await import('./pr-provider');
 const p={number:1,title:'Title',body:'x'.repeat(900),state:'closed',head:{sha:'a'},labels:Array.from({length:12},(_,i)=>({name:String(i)})),user:{login:'dev'}};
 const n={merged:true,headRefOid:'a',reviewDecision:'APPROVED',commits:{nodes:[{commit:{oid:'a',statusCheckRollup:{state:'FAILURE'}}}]}};
 const good=inboxSummary(p,n);assert.equal(inboxSummary({...p,body:'<!-- hidden template STOP -->\n### Real authored description'}).preview,'Real authored description');assert.equal(good.state,'merged');assert.equal(good.ci,'FAILURE');assert.equal(good.preview.length,320);assert.equal(good.labels.length,10);assert.equal(good.labelsTruncated,true);
 assert.equal(inboxSummary(p).ci,'Unavailable');assert.equal(inboxSummary(p,{...n,headRefOid:'b'}).review,'Unavailable');assert.equal(inboxSummary(p,{...n,commits:{nodes:[{commit:{oid:'b'}}]}}).ci,'Unavailable');
});
test('inbox batches a page once and retains candidates on failed hydration',async()=>{
 const calls:any[]=[];let fail=false;
 const rows=Array.from({length:50},(_,i)=>({number:i+1,node_id:`PR_${i}`,title:'Candidate',state:'open',body:'preview',head:{sha:'a'},labels:[]}));
 const service=createPrService(async(_cwd,args,body)=>{calls.push({args,body});if(args[1]==='graphql'){if(fail)throw Error('denied');return JSON.stringify({data:{nodes:rows.map(p=>({id:p.node_id,number:p.number,repository:{nameWithOwner:'a/b'},headRefOid:'a',reviewDecision:'REVIEW_REQUIRED',commits:{nodes:[{commit:{oid:'a',statusCheckRollup:{state:'PENDING'}}}]}}))}})}return JSON.stringify(rows)},async()=> 'https://github.com/a/b.git');
 const first=await service.list('/repo',{state:'open',search:'',page:1});assert.equal(first.inbox.length,50);assert.equal(first.inbox[0].ci,'PENDING');assert.equal(calls.length,2);assert.match(calls[0].args[1],/sort=updated/);assert.equal(calls[1].body.variables.ids.length,50);
 fail=true;const failed=await service.list('/repo',{state:'open',search:'',page:1});assert.equal(failed.inbox.length,50);assert.equal(failed.inbox[0].ci,'Unavailable');assert.equal(calls.length,4);
});
