export function gitButtonTone(label:string){
 if(/discard|delete|remove|drop|use (ours|theirs)/i.test(label))return 'danger';
 if(/^(push|commit|stage|mark resolved)/i.test(label))return 'good';
 if(/^(fetch|pull|checkout|track|new)/i.test(label))return 'review';
 if(/^(stash|unstage|rebase|merge|prune|apply|reset|revert|cherry-pick)/i.test(label))return 'warn';
 return 'neutral';
}
export function prActionStyle(action:string,extra:Record<string,unknown>={},event='COMMENT'){
 if(action==='merge')return {label:extra.strategy==='squash'?'Squash and merge':extra.strategy==='rebase'?'Rebase and merge':'Merge pull request',tone:'good'};
 if(action==='review')return {label:event==='APPROVE'?'Approve pull request':event==='REQUEST_CHANGES'?'Request changes':'Submit review',tone:event==='APPROVE'?'good':event==='REQUEST_CHANGES'?'warn':'review'};
 if(action==='state')return {label:extra.state==='closed'?'Close pull request':'Reopen pull request',tone:extra.state==='closed'?'warn':'good'};
 if(action==='draft')return {label:extra.draft?'Mark as draft':'Mark ready for review',tone:extra.draft?'warn':'good'};
 if(action==='resolve')return {label:extra.resolved?'Resolve discussion':'Reopen discussion',tone:extra.resolved?'good':'warn'};
 const styles:Record<string,{label:string;tone:string}>={create:{label:'Create pull request',tone:'good'},edit:{label:'Save changes',tone:'good'},metadata:{label:'Save changes',tone:'review'},comment:{label:'Post comment',tone:'review'},reply:{label:'Post reply',tone:'review'},reaction:{label:extra.remove?'Remove reaction':'Add reaction',tone:'review'},checkout:{label:'Checkout pull request',tone:'review'},worktree:{label:'Create review worktree',tone:'review'},rerun:{label:'Rerun failed jobs',tone:'warn'},cancel:{label:'Cancel workflow run',tone:'danger'},'auto-merge':{label:'Enable auto-merge',tone:'good'},'disable-auto-merge':{label:'Disable auto-merge',tone:'warn'}};
 return styles[action]||{label:'Confirm action',tone:'good'};
}
