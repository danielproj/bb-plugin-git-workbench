import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
export const actions = [
  "stage",
  "unstage",
  "discard",
  "commit",
  "fetch",
  "pull",
  "push",
  "checkout",
  "branch-create",
  "branch-delete",
  "branch-rename",
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "reset",
  "tag-create",
  "tag-delete",
  "stash-save",
  "stash-apply",
  "stash-pop",
  "stash-drop",
  "remote-add",
  "remote-remove",
  "remote-url",
  "worktree-add",
  "worktree-remove",
  "worktree-prune",
  "merge-abort",
  "rebase-abort",
  "rebase-continue",
  "cherry-pick-abort",
  "cherry-pick-continue",
  "ours",
  "theirs",
  "apply-patch",
] as const;
export const operation = z.object({
  action: z.enum(actions),
  value: z.string().max(10000).default(""),
  extra: z.string().max(10000).default(""),
  paths: z.array(z.string().min(1).max(4096)).max(2000).default([]),
  flag: z.boolean().default(false),
  mode: z.enum(["soft", "mixed", "hard"]).default("mixed"),
  patch: z.string().max(500000).default(""),
  confirmed: z.boolean().default(false),
});
export type Operation = z.infer<typeof operation>;
const file = z.object({
  path: z.string(),
  original: z.string().optional(),
  index: z.string(),
  worktree: z.string(),
  conflict: z.boolean(),
});
const commit = z.object({
  sha: z.string(),
  parents: z.array(z.string()),
  subject: z.string(),
  author: z.string(),
  date: z.string(),
  refs: z.string(),
});
export type Commit = z.infer<typeof commit>;
export const snapshot = z.object({
  root: z.string(),
  branch: z.string(),
  upstream: z.string(),
  ahead: z.number(),
  behind: z.number(),
  files: z.array(file),
  commits: z.array(commit),
  refs: z.array(
    z.object({
      name: z.string(),
      kind: z.string(),
      current: z.boolean(),
      upstream: z.string(),
    }),
  ),
  stashes: z.array(z.object({ ref: z.string(), subject: z.string() })),
  remotes: z.string(),
  worktrees: z.string(),
  operation: z.string(),
});
export type Snapshot = z.infer<typeof snapshot>;
const read = z.object({
  kind: z.enum([
    "diff",
    "commit",
    "commit-files",
    "blame",
    "history",
    "reflog",
    "stash",
  ]),
  value: z.string().default(""),
  path: z.string().default(""),
  staged: z.boolean().default(false),
  ignoreWhitespace: z.boolean().default(false),
});
export type Read = z.infer<typeof read>;
const result = z.object({ text: z.string(), truncated: z.boolean() });
const query = z.object({
  search: z.string().max(200).default(""),
  branch: z.string().max(500).default(""),
  author: z.string().max(200).default(""),
  path: z.string().max(4096).default(""),
  since: z.string().max(40).default(""),
  limit: z.number().int().min(10).max(2000).default(200),
});
export type Query = z.infer<typeof query>;
export const hostContract = defineRpcContract({
  resolveWorktree: {
    input: z.object({ cwd: z.string(), path: z.string() }),
    output: z.object({ cwd: z.string() }),
  },
  snapshot: { input: z.object({ cwd: z.string(), query }), output: snapshot },
  read: { input: z.object({ cwd: z.string(), read }), output: result },
  mutate: {
    input: z.object({ cwd: z.string(), op: operation }),
    output: result,
  },
});
export const rpcContract = defineRpcContract({
  projects: {
    input: z.object({}),
    output: z.array(z.object({ id: z.string(), name: z.string() })),
  },
  repositories: {
    input: z.object({ projectId: z.string().optional() }),
    output: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        path: z.string(),
        hostId: z.string(),
      }),
    ),
  },
  snapshot: {
    input: z.object({
      environmentId: z.string(),
      worktreePath: z.string().optional(),
      query,
    }),
    output: snapshot,
  },
  read: {
    input: z.object({
      environmentId: z.string(),
      worktreePath: z.string().optional(),
      read,
    }),
    output: result,
  },
  mutate: {
    input: z.object({
      environmentId: z.string(),
      worktreePath: z.string().optional(),
      op: operation,
    }),
    output: result,
  },
});
