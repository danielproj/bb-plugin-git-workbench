import { z } from 'zod';
import { repositorySchema } from './read-contract';

export function normalizeRemote(value:string):string {
 const text=value.trim();
 if (!text || /[\s\x00-\x1f\x7f]/.test(text)) throw Error('Enter an HTTPS or SSH Git URL.');
 if (/^[a-zA-Z0-9_][a-zA-Z0-9._-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*:[^?#]+$/.test(text)) return text;
 let url:URL;
 try {url=new URL(text);} catch {throw Error('Enter an HTTPS or SSH Git URL.');}
 if (!['https:','ssh:'].includes(url.protocol) || !url.hostname || !url.pathname || url.pathname==='/') throw Error('Enter an HTTPS or SSH Git URL.');
 if (url.password || url.search || url.hash || url.protocol==='https:'&&url.username) throw Error('Use the machine’s Git credentials instead of including credentials or query parameters in the URL.');
 if (url.username && !/^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/.test(url.username)) throw Error('Invalid SSH user.');
 return url.href;
}
export const remoteSchema=z.string().max(4096).transform((value,ctx)=>{try{return normalizeRemote(value);}catch(e){ctx.addIssue({code:'custom',message:(e as Error).message});return z.NEVER;}});
export const cloneRequest=z.object({
 id:z.string().uuid(),confirmed:z.literal(true),hostId:z.string().min(1).max(200),
 remoteUrl:remoteSchema,path:z.string().trim().min(1).max(4096).refine(p=>!/[\x00-\x1f\x7f]/.test(p)&&(/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(p)), 'Enter an absolute destination path on the selected machine.'),
 name:z.string().trim().min(1).max(100),retry:z.boolean().default(false),
});
export type CloneRequest=z.infer<typeof cloneRequest>;
export const cloneOptionsSchema=z.object({hosts:z.array(z.object({id:z.string(),name:z.string(),directory:z.string()})),warnings:z.array(z.string())});
export const cloneJobSchema=z.object({
 id:z.string(),status:z.enum(['cloning','registering','ready','failed']),message:z.string(),
 hostId:z.string(),path:z.string(),remoteUrl:z.string(),name:z.string(),checkoutCreated:z.boolean(),
 projectId:z.string().optional(),repository:repositorySchema.optional(),
});
export type CloneJob=z.infer<typeof cloneJobSchema>;
export type CloneOptions=z.infer<typeof cloneOptionsSchema>;
export function repositoryName(remote:string){
 let leaf=remote.trim().replace(/\/+$/,'').split(/[/:]/).pop()||'';
 try{leaf=decodeURIComponent(leaf);}catch{}
 return leaf.replace(/\.git$/i,'').replace(/[^a-zA-Z0-9._-]/g,'-').replace(/^\.+$/,'')||'repository';
}
export function checkoutPath(directory:string,name:string){return directory.replace(/[\\/]+$/,'')+(directory.includes('\\')?'\\':'/')+name;}
