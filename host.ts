import { realpath } from "node:fs/promises";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./contract";
import { getSnapshot, readGit, mutateGit, git } from "./git";
const locks = new Map<string, Promise<unknown>>();
export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
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
      return { cwd: requested };
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
