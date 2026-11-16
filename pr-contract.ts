import { z } from 'zod';
const number = z.number().int().positive();
const text = z.string().max(60000);
const sha = z.string().regex(/^[a-f0-9]{40}$/i);
export const prQuery = z.object({state:z.enum(['open','closed','all']).default('open'), search:z.string().max(200).default(''), page:number.max(100).default(1)});
export const prRead = z.object({number,kind:z.enum(['detail','files','commits','comments','threads','checks','diff','logs','jobs','metadata']),page:number.max(100).default(1),runId:number.optional()});
const inline = z.object({path:z.string().min(1).max(4096),line:number,side:z.enum(['LEFT','RIGHT']),body:text.min(1),start_line:number.optional(),start_side:z.enum(['LEFT','RIGHT']).optional()});
export const prMutation = z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),confirmed:z.literal(true),title:text.min(1),body:text,base:z.string().min(1).max(255),head:z.string().min(1).max(255),draft:z.boolean()}),
 ...(['edit','state','draft','metadata','review','comment','reply','reaction','resolve','rerun','cancel','merge','auto-merge','disable-auto-merge','checkout','worktree'] as const).map(action=>z.object({action:z.literal(action),confirmed:z.literal(true),number,expectedHead:sha,title:text.optional(),body:text.optional(),state:z.enum(['open','closed']).optional(),draft:z.boolean().optional(),labels:z.array(z.string().max(100)).max(100).optional(),assignees:z.array(z.string().max(100)).max(100).optional(),reviewers:z.array(z.string().max(100)).max(100).optional(),event:z.enum(['COMMENT','APPROVE','REQUEST_CHANGES']).optional(),comments:z.array(inline).max(100).optional(),id:z.string().max(200).optional(),remove:z.boolean().optional(),commentKind:z.enum(['issue','review']).optional(),reaction:z.enum(['+1','-1','laugh','confused','heart','hooray','rocket','eyes']).optional(),resolved:z.boolean().optional(),runId:number.optional(),strategy:z.enum(['merge','squash','rebase']).optional(),path:z.string().max(4096).optional()}))
]);
export type PrMutation=z.infer<typeof prMutation>;
export type PrRead=z.infer<typeof prRead>;
export const prSummary=z.object({number,title:z.string(),body:z.string(),state:z.string(),url:z.string(),draft:z.boolean(),head:sha,base:z.string(),branch:z.string(),author:z.string(),mergeable:z.boolean().nullable(),mergeState:z.string()});
const user=z.object({login:z.string()});
export const prFile=z.object({filename:z.string(),previous_filename:z.string().optional(),status:z.string(),additions:z.number(),deletions:z.number(),patch:z.string().optional(),blob_url:z.string().optional()});
export const prComment=z.object({id:z.number(),body:z.string(),html_url:z.string(),user:user.nullable()});
export const prThread=z.object({id:z.string(),isResolved:z.boolean(),isOutdated:z.boolean(),path:z.string(),line:z.number().nullable(),diffSide:z.string(),viewerCanResolve:z.boolean(),viewerCanUnresolve:z.boolean(),comments:z.object({nodes:z.array(z.object({databaseId:z.number().nullable(),id:z.string(),body:z.string(),author:user.nullable(),url:z.string()})),pageInfo:z.object({hasNextPage:z.boolean()})})});
export const prCheck=z.object({id:z.number(),name:z.string(),status:z.string(),conclusion:z.string().nullable(),details_url:z.string().nullable(),started_at:z.string().nullable().optional(),completed_at:z.string().nullable().optional(),app:z.object({name:z.string(),slug:z.string().optional()}).nullable().optional(),output:z.object({title:z.string().nullable(),summary:z.string().nullable(),text:z.string().nullable()})});
export const prChecks=z.object({head:z.string(),checkRuns:z.array(prCheck),statuses:z.array(z.object({id:z.number(),context:z.string(),state:z.string(),description:z.string().nullable(),target_url:z.string().nullable(),created_at:z.string().optional(),updated_at:z.string().optional()})),requiredCoverage:z.enum(['complete','unknown']),contexts:z.array(z.object({__typename:z.string(),name:z.string().optional(),context:z.string().optional(),status:z.string().optional(),state:z.string().optional(),conclusion:z.string().nullable().optional(),isRequired:z.boolean()}))});
export const prPermissions=z.object({viewerPermission:z.string().nullable(),mergeCommitAllowed:z.boolean(),squashMergeAllowed:z.boolean(),rebaseMergeAllowed:z.boolean(),pullRequest:z.object({id:z.string(),viewerDidAuthor:z.boolean(),viewerCanClose:z.boolean(),viewerCanReopen:z.boolean(),viewerCanEnableAutoMerge:z.boolean(),viewerCanDisableAutoMerge:z.boolean(),reviewDecision:z.string().nullable(),mergeStateStatus:z.string(),autoMergeRequest:z.object({enabledAt:z.string(),mergeMethod:z.string()}).nullable(),reviewRequests:z.object({nodes:z.array(z.json()),pageInfo:z.object({hasNextPage:z.boolean()})})})});
export const prDetail=z.object({pr:prSummary,data:z.json(),permissions:prPermissions});
export const prInboxSummary=z.object({number,title:z.string().max(1000),preview:z.string().max(320),state:z.enum(['open','draft','closed','merged','unknown']),author:z.string(),branch:z.string(),base:z.string(),labels:z.array(z.string()),labelsTruncated:z.boolean(),updatedAt:z.string(),ci:z.string(),review:z.string(),healthAvailable:z.boolean()});
export type PrInboxSummary=z.infer<typeof prInboxSummary>;
export const prResult=z.object({items:z.array(z.json()),coverageComplete:z.boolean(),nextPage:z.number().nullable(),text:z.string(),truncated:z.boolean(),inbox:z.array(prInboxSummary).max(50).optional(),searchComplete:z.boolean().optional(),detail:prDetail.optional(),commits:z.array(z.object({sha:z.string(),html_url:z.string(),commit:z.object({message:z.string(),author:z.object({name:z.string(),date:z.string()}).nullable()})})).optional(),files:z.array(prFile).optional(),threads:z.array(prThread).optional(),comments:z.array(prComment).optional(),runsCoverageComplete:z.boolean().optional(),runs:z.array(z.object({id:z.number(),run_number:z.number().optional(),run_attempt:z.number().optional(),event:z.string().optional(),head_branch:z.string().nullable().optional(),display_title:z.string().optional(),created_at:z.string().optional(),updated_at:z.string().optional(),run_started_at:z.string().nullable().optional(),name:z.string().nullable(),head_sha:z.string(),status:z.string().nullable(),conclusion:z.string().nullable(),html_url:z.string()})).optional(),checks:prChecks.optional()});
export const prMutationResult=prResult.extend({applied:z.literal(true),refreshError:z.string().optional()});
export type PrResult=z.infer<typeof prResult>;
const target={environmentId:z.string(),worktreePath:z.string().optional()};
export const prRpc={
 prList:{input:z.object({...target,query:prQuery}),output:prResult},
 prRead:{input:z.object({...target,read:prRead}),output:prResult},
 prMutate:{input:z.object({...target,op:prMutation}),output:prMutationResult},
};
export const prHostRpc={
 prList:{input:z.object({cwd:z.string(),query:prQuery}),output:prResult},
 prRead:{input:z.object({cwd:z.string(),read:prRead}),output:prResult},
 prMutate:{input:z.object({cwd:z.string(),op:prMutation}),output:prMutationResult},
};
