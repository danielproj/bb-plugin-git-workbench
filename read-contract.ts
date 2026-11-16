import { z } from "zod";
const file = z.object({
  path: z.string(),
  original: z.string().optional(),
  index: z.string(),
  worktree: z.string(),
  conflict: z.boolean(),
});
export const commitSchema = z.object({
  sha: z.string(),
  parents: z.array(z.string()),
  subject: z.string(),
  author: z.string(),
  date: z.string(),
  refs: z.string(),
});
export type Commit = z.infer<typeof commitSchema>;
export const snapshot = z.object({
  root: z.string(),
  branch: z.string(),
  upstream: z.string(),
  ahead: z.number(),
  behind: z.number(),
  files: z.array(file),
  commits: z.array(commitSchema),
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
export const readSchema = z.object({
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
export type Read = z.infer<typeof readSchema>;
export const readResultSchema = z.object({ text: z.string(), truncated: z.boolean() });
export const querySchema = z.object({
  search: z.string().max(200).default(""),
  branch: z.string().max(500).default(""),
  author: z.string().max(200).default(""),
  path: z.string().max(4096).default(""),
  since: z.string().max(40).default(""),
  limit: z.number().int().min(10).max(2000).default(200),
});
export type Query = z.infer<typeof querySchema>;
export const repositorySchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  hostId: z.string(),
  hostName: z.string().optional(),
  projectIds: z.array(z.string()).optional(),
  projectNames: z.array(z.string()).optional(),
  legacyIds: z.array(z.string()).optional(),
});
export const gitIdentitySchema = z.object({ root: z.string(), commonDir: z.string(), incarnation: z.string() });
export const rootProvenanceSchema = z.object({ requestedPath: z.string(), canonicalPath: z.string().optional(), state: z.enum(["present", "missing", "error"]) });
export const setupCandidateSchema = z.object({
  id: z.string(), projectId: z.string(), projectName: z.string(), sourceId: z.string().optional(),
  hostId: z.string(), hostName: z.string(), path: z.string().optional(), name: z.string(),
  state: z.literal("missing"), action: z.enum(["restore", "clone"]),
});
export type SetupCandidate = z.infer<typeof setupCandidateSchema>;
export const scanResultSchema = z.object({ roots: z.array(rootProvenanceSchema), repositories: z.array(gitIdentitySchema.extend({ mainRoot: z.string().optional() })), complete: z.boolean(), warnings: z.array(z.string()) });
export const catalogSchema = z.object({ setupCandidates: z.array(setupCandidateSchema), repositories: z.array(repositorySchema), complete: z.boolean(), warnings: z.array(z.string()) });
export type Repository = z.infer<typeof repositorySchema>;
