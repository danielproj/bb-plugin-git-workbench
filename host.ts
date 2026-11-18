import { scanRepositories, gitIdentity } from "./catalog-host";
import { createPrService } from './pr-service';
import { readPrImage } from './pr-image-host';
const prs = createPrService();
import { inspectCheckout, restoreCheckout } from "./checkout";
import { realpath } from "node:fs/promises";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./contract";
import { getSnapshot, readGit, mutateGit, git } from "./git";
import {cloneDirectory,cloneRepository,verifyClone} from './clone-host';
const locks = new Map<string, Promise<unknown>>();
export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    cloneDirectory: () => cloneDirectory(),
    cloneRepository: ({path,remoteUrl},ctx) => cloneRepository(path,remoteUrl,ctx.signal),
    verifyClone: ({identity,remoteUrl},ctx) => verifyClone(identity,remoteUrl,ctx.signal),
    scanRepositories: ({ roots }, ctx) => scanRepositories(roots, ctx.signal),
    gitIdentity: ({ path }, ctx) => gitIdentity(path, ctx.signal),
    prList: ({cwd,query},ctx) => prs.list(cwd,query,ctx.signal),
    prRead: ({cwd,read},ctx) => prs.read(cwd,read,ctx.signal),
    prImage: ({cwd,source},ctx) => readPrImage(cwd,source,ctx.signal),
    prMutate: async ({cwd,op},ctx) => {
      const key=(await git(cwd,['rev-parse','--path-format=absolute','--git-common-dir'],ctx.signal)).trim();
      const previous=locks.get(key)??Promise.resolve();
      const next=previous.catch(()=>{}).then(()=>prs.mutate(cwd,op,ctx.signal));
      locks.set(key,next);
      try{return await next;}finally{if(locks.get(key)===next)locks.delete(key);}
    },
    inspectCheckout: ({ path }, ctx) => inspectCheckout(path, ctx.signal),
    restoreCheckout: async ({ path, remoteUrl }, ctx) => {
      await restoreCheckout(path, remoteUrl, ctx.signal);
      return { ready: true as const };
    },
    resolveWorktree: async ({ cwd, path }, ctx) => {
      const listed = await git(
        cwd,
        ["worktree", "list", "--porcelain", "-z"],
        ctx.signal,
      );
      const requested = await realpath(path);
      const known = await Promise.all(
        listed
          .split("\0")
          .filter((token) => token.startsWith("worktree "))
          .map((token) => realpath(token.slice(9)).catch(() => null)),
      );
      if (!known.includes(requested))
        throw Error("Worktree is not part of this repository.");
      const selected = await gitIdentity(cwd, ctx.signal);
      const target = await gitIdentity(requested, ctx.signal);
      if (target.commonDir !== selected.commonDir || target.incarnation !== selected.incarnation)
        throw Error("Worktree is not part of this repository.");
      return { cwd: target.root };
    },
    snapshot: ({ cwd, query }, ctx) => getSnapshot(cwd, query, ctx.signal),
    read: ({ cwd, read }, ctx) => readGit(cwd, read, ctx.signal),
    mutate: async ({ cwd, op }, ctx) => {
      const key = (
        await git(
          cwd,
          ["rev-parse", "--path-format=absolute", "--git-common-dir"],
          ctx.signal,
        )
      ).trim();
      const previous = locks.get(key) ?? Promise.resolve();
      const next = previous
        .catch(() => {})
        .then(() => mutateGit(cwd, op, ctx.signal));
      locks.set(key, next);
      try {
        return await next;
      } finally {
        if (locks.get(key) === next) locks.delete(key);
      }
    },
  },
});
