import { snapshot, querySchema as query, readSchema as read, readResultSchema as result, repositorySchema, gitIdentitySchema, scanResultSchema, catalogSchema } from "./read-contract";
export * from "./read-contract";
import { prRpc, prHostRpc } from './pr-contract';
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { cloneRequest, cloneOptionsSchema, cloneJobSchema } from "./clone-contract";
export const actions = [
  "stage",
  "unstage",
  "discard",
  "commit",
  "fetch",
  "pull",
  "push",
  "checkout",
  "checkout-remote",
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
export const checkoutSetupSchema = z.object({
  status: z.enum(["preparing", "ready", "failed"]),
  message: z.string(),
  repositories: z.array(repositorySchema),
});
export type CheckoutSetup = z.infer<typeof checkoutSetupSchema>;
export const hostContract = defineRpcContract({
  ...prHostRpc,
  cloneDirectory: {input:z.object({}),output:z.object({directory:z.string()})},
  cloneRepository: {input:cloneRequest.pick({path:true,remoteUrl:true}),output:gitIdentitySchema},
  verifyClone: {input:z.object({identity:gitIdentitySchema,remoteUrl:cloneRequest.shape.remoteUrl}),output:gitIdentitySchema},
  scanRepositories: { input: z.object({ roots: z.array(z.string()).max(1000) }), output: scanResultSchema },
  gitIdentity: { input: z.object({ path: z.string() }), output: gitIdentitySchema },
  restoreCheckout: {
    input: z.object({ path: z.string(), remoteUrl: z.string().min(1) }),
    output: z.object({ ready: z.literal(true) }),
  },
  inspectCheckout: {
    input: z.object({ path: z.string() }),
    output: z.object({ state: z.enum(["ready", "missing", "not_git"]) }),
  },
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
  ...prRpc,
  cloneOptions: {input:z.object({}),output:cloneOptionsSchema},
  cloneStart: {input:cloneRequest,output:cloneJobSchema},
  cloneStatus: {input:z.object({id:z.string().uuid()}),output:cloneJobSchema},
  projects: {
    input: z.object({}),
    output: z.array(z.object({ id: z.string(), name: z.string() })),
  },
  catalog: {
    input: z.object({ projectId: z.string().optional(), refresh: z.boolean().default(false) }),
    output: catalogSchema,
  },
  repositories: {
    input: z.object({ projectId: z.string().optional() }),
    output: z.array(repositorySchema),
  },
  setupCheckout: {
    input: z.object({
      projectId: z.string().min(1),
      retry: z.boolean().default(false),
      sourceId: z.string().optional(),
      hostId: z.string().optional(),
    }),
    output: checkoutSetupSchema,
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
