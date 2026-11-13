import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, rpcContract } from "./contract";
export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  async function repository(environmentId: string, worktreePath?: string) {
    const e = await bb.sdk.environments.get({ environmentId });
    if (!e.path || e.status !== "ready")
      throw Error("Repository environment is not ready.");
    const cwd = worktreePath
      ? (
          await host.call(
            "resolveWorktree",
            { cwd: e.path, path: worktreePath },
            { hostId: e.hostId },
          )
        ).cwd
      : e.path;
    return { cwd, hostId: e.hostId };
  }
  bb.rpc.register(rpcContract, {
    projects: async () =>
      (await bb.sdk.projects.list({ includePersonal: true })).map((p) => ({
        id: p.id,
        name: p.name,
      })),
    repositories: async ({ projectId }) =>
      (await bb.sdk.environments.list({ projectId, limit: 1000 }))
        .filter((e) => e.isGitRepo && e.path && e.status === "ready")
        .sort(
          (a, b) =>
            Number(a.isWorktree) - Number(b.isWorktree) ||
            a.path!.length - b.path!.length,
        )
        .map((e) => ({
          id: e.id,
          name: e.name || e.branchName || e.path!,
          path: e.path!,
          hostId: e.hostId,
        })),
    snapshot: async ({ environmentId, worktreePath, query }, ctx) => {
      const { cwd, hostId } = await repository(environmentId, worktreePath);
      return host.call(
        "snapshot",
        { cwd, query },
        { hostId, signal: ctx.experimental_signal },
      );
    },
    read: async ({ environmentId, worktreePath, read }, ctx) => {
      const { cwd, hostId } = await repository(environmentId, worktreePath);
      return host.call(
        "read",
        { cwd, read },
        { hostId, signal: ctx.experimental_signal },
      );
    },
    mutate: async ({ environmentId, worktreePath, op }, ctx) => {
      const { cwd, hostId } = await repository(environmentId, worktreePath);
      try {
        return await host.call(
          "mutate",
          { cwd, op },
          { hostId, signal: ctx.experimental_signal },
        );
      } finally {
        bb.realtime.publish("changed", { environmentId });
      }
    },
  });
}
