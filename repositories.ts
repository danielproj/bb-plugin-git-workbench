import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Repository, CheckoutSetup } from "./contract";

type Sdk = Pick<BbPluginApi["sdk"], "environments" | "projects" | "hosts">;
export type CheckoutInspection = { state: "ready" | "missing" | "not_git" };
type Inspect = (hostId: string, path: string) => Promise<CheckoutInspection>;
export function sourceRepositoryId(projectId: string, sourceId: string) {
  return `source:${projectId}:${sourceId}`;
}
export function sourceIdentity(id: string) {
  if (!id.startsWith("source:")) return null;
  const parts = id.split(":");
  if (parts.length !== 3 || !parts[1] || !parts[2])
    throw Error("Invalid project checkout.");
  return { projectId: parts[1]!, sourceId: parts[2]! };
}
export function createRepositoryService(
  sdk: () => Sdk,
  inspect: Inspect,
  restore: (
    hostId: string,
    path: string,
    remoteUrl: string,
  ) => Promise<unknown>,
) {
  const jobs = new Map<string, CheckoutSetup>();
  const inFlight = new Map<string, Promise<void>>();
  let disposed = false;
  const sourceRow = (
    projectId: string,
    s: { id: string; hostId: string; path: string },
  ): Repository => ({
    id: sourceRepositoryId(projectId, s.id),
    name: s.path.split(/[\\/]/).filter(Boolean).pop() || "Project checkout",
    path: s.path,
    hostId: s.hostId,
  });
  async function list(projectId?: string): Promise<Repository[]> {
    const environments = await sdk().environments.list({
      ...(projectId ? { projectId } : {}),
      limit: 1000,
    });
    const ready = environments
      .filter(
        (e) =>
          e.isGitRepo &&
          e.path &&
          e.status === "ready" &&
          e.lifecycle.phase === "active" &&
          e.hostLifecycle === "active",
      )
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
      }));
    if (ready.length || !projectId) return ready;
    const project = await sdk().projects.get({ projectId });
    if (!project.sources.length) return [];
    const hosts = await sdk().hosts.list();
    const result: Repository[] = [];
    for (const source of [...project.sources].sort(
      (a, b) => Number(b.isDefault) - Number(a.isDefault),
    )) {
      if (
        !hosts.some(
          (h) =>
            h.id === source.hostId &&
            h.status === "connected" &&
            h.lifecycle.phase === "active",
        )
      )
        continue;
      if ((await inspect(source.hostId, source.path)).state === "ready")
        result.push(sourceRow(projectId, source));
    }
    return result;
  }
  async function resolve(id: string) {
    const source = sourceIdentity(id);
    if (source) {
      const project = await sdk().projects.get({ projectId: source.projectId });
      const s = project.sources.find((s) => s.id === source.sourceId);
      if (!s)
        throw Error(
          "Project checkout is no longer registered. Select the project again.",
        );
      if ((await inspect(s.hostId, s.path)).state !== "ready") throw Error("Project checkout is missing or not a Git root.");
      return { cwd: s.path, hostId: s.hostId };
    }
    const e = await sdk().environments.get({ environmentId: id });
    if (
      !e.path ||
      e.status !== "ready" ||
      e.lifecycle.phase !== "active" ||
      e.hostLifecycle !== "active"
    )
      throw Error("Repository environment is not ready.");
    if ((await inspect(e.hostId, e.path)).state !== "ready") throw Error("Repository checkout is missing or not a Git root.");
    return { cwd: e.path, hostId: e.hostId };
  }
  async function prepare(projectId: string, sourceId?: string, jobKey = projectId, requestedHostId?: string) {
    try {
      const existing = (await list(projectId)).filter(r => (!sourceId || r.id === sourceRepositoryId(projectId, sourceId)) && (!requestedHostId || r.hostId === requestedHostId));
      if (disposed) return;
      if (existing.length) {
        jobs.set(jobKey, {
          status: "ready",
          message: "Checkout ready.",
          repositories: existing,
        });
        return;
      }
      const project = await sdk().projects.get({ projectId });
      if (project.kind === "personal")
        throw Error("Choose a Git project to open a checkout.");
      const hosts = await sdk().hosts.list();
      if (sourceId && requestedHostId && !project.sources.some(s => s.id === sourceId && s.hostId === requestedHostId)) throw Error("Selected source machine changed.");
      if (sourceId && !project.sources.some(s => s.id === sourceId)) throw Error("Project source is no longer registered.");
      const source = [...project.sources.filter(s => (!sourceId || s.id === sourceId) && (!requestedHostId || s.hostId === requestedHostId))]
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
        .find((s) =>
          hosts.some(
            (h) =>
              h.id === s.hostId &&
              h.status === "connected" &&
              h.lifecycle.phase === "active",
          ),
        );
      if (project.sources.length && !source)
        throw Error("The project’s machine is offline. Connect it and retry.");
      if (source) {
        const state = await inspect(source.hostId, source.path);
        if (state.state === "ready") {
          jobs.set(jobKey, {
            status: "ready",
            message: "Project checkout opened.",
            repositories: [sourceRow(projectId, source)],
          });
          return;
        }
        if (state.state === "not_git")
          throw Error(
            "The project directory exists but is not a Git repository. Choose a Git source in the project settings.",
          );
      }
      if (!project.gitRemoteUrl)
        throw Error(
          "Add a Git remote in the project settings so BB can clone this project.",
        );
      const machine = source
        ? hosts.find((h) => h.id === source.hostId)
        : hosts
            .filter(
              (h) =>
                h.status === "connected" &&
                h.lifecycle.phase === "active" &&
                h.type === "persistent" && (!requestedHostId || h.id === requestedHostId),
            )
            .sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!machine)
        throw Error("Connect a machine to BB so it can prepare this checkout.");
      if (disposed) return;
      jobs.set(jobKey, {
        status: "preparing",
        message: `Cloning the project on ${machine.name}…`,
        repositories: [],
      });
      let created: (typeof project.sources)[number];
      if (source) {
        await restore(source.hostId, source.path, project.gitRemoteUrl);
        created = source;
      } else
        created = await sdk().projects.sources.add({
          projectId,
          hostId: machine.id,
          type: "clone",
        });
      if (disposed) return;
      if ((await inspect(created.hostId, created.path)).state !== "ready")
        throw Error(
          "The checkout is not ready after setup. Check the project source and retry.",
        );
      jobs.set(jobKey, {
        status: "ready",
        message: "Checkout ready.",
        repositories: [sourceRow(projectId, created)],
      });
    } catch (error) {
      if (!disposed)
        jobs.set(jobKey, {
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
          repositories: [],
        });
    }
  }
  const requestKeys = new Map<string, string>();
  const requestKey = (projectId: string, sourceId?: string, hostId?: string) =>
    JSON.stringify([projectId, sourceId ?? null, hostId ?? null]);
  async function setup(projectId: string, retry = false, sourceId?: string, hostId?: string): Promise<CheckoutSetup> {
    if (disposed) throw Error("Plugin was reloaded. Refresh and retry.");
    // Re-read registration before acknowledging either a preparing or ready job.
    const project = await sdk().projects.get({ projectId });
    if (sourceId && !project.sources.some(s => s.id === sourceId && (!hostId || s.hostId === hostId)))
      return { status: "failed", message: "Selected source machine changed or is no longer registered.", repositories: [] };
    if (disposed) throw Error("Plugin was reloaded. Refresh and retry.");
    const key = requestKey(projectId, sourceId, hostId);
    const jobKey = JSON.stringify([key, project.gitRemoteUrl, project.sources.map(s =>
      [s.id, s.hostId, s.path, s.updatedAt, s.isDefault, s.type])]);
    requestKeys.set(key, jobKey);
    const current = jobs.get(jobKey);
    if (current && (!retry || inFlight.has(jobKey))) return current;
    if (jobs.size >= 100) {
      for (const [key, job] of jobs)
        if (job.status !== "preparing") {
          jobs.delete(key);
          break;
        }
      if (jobs.size >= 100)
        throw Error("Too many checkout setups are running. Try again shortly.");
    }
    const job: CheckoutSetup = {
      status: "preparing",
      message: "Looking for a project checkout…",
      repositories: [],
    };
    jobs.set(jobKey, job);
    const promise = prepare(projectId, sourceId, jobKey, hostId).finally(() =>
      inFlight.delete(jobKey),
    );
    inFlight.set(jobKey, promise);
    return job;
  }
  return {
    list,
    resolve,
    setup,
    dispose() {
      disposed = true;
      jobs.clear();
      requestKeys.clear();
    },
    async wait(projectId: string, sourceId?: string, hostId?: string) {
      const jobKey = requestKeys.get(requestKey(projectId, sourceId, hostId));
      if (!jobKey) return undefined;
      await inFlight.get(jobKey);
      return jobs.get(jobKey);
    },
  };
}
