import { createHash } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Repository, SetupCandidate } from "./contract";
import type { GitIdentity, ScanResult } from "./catalog-host";
type Sdk = Pick<BbPluginApi["sdk"], "projects" | "environments" | "hosts">;
type Transport = {
  scan: (hostId: string, roots: string[]) => Promise<ScanResult>;
  identity: (hostId: string, path: string) => Promise<GitIdentity>;
};
type Anchor = { hostId: string; path: string; projectId: string; projectName: string; legacyId: string; sourceId?: string; remoteUrl?: string | null };
export const repositoryId = (hostId: string, identity: GitIdentity) => "repo:" + createHash("sha256").update(JSON.stringify([hostId, identity.commonDir, identity.incarnation])).digest("hex");
const key=repositoryId;
const within = (root: string, anchor: string) => root === anchor || root.startsWith(anchor.replace(/\/$/, "") + "/");
export function createCatalog(sdk: () => Sdk, transport: Transport) {
  // Registry is only a hint. Every resolve obtains current trust anchors and host identity again.
  const registry = new Map<string, { hostId: string; identity: GitIdentity; projectIds: string[]; bindings: { legacyId: string; path: string; target: string }[] }>();
  async function anchors(projectId?: string): Promise<{ anchors: Anchor[]; truncated: boolean; projects: Awaited<ReturnType<Sdk["projects"]["list"]>> }> {
    const projects = projectId ? [await sdk().projects.get({ projectId })] : await sdk().projects.list({ includePersonal: true });
    const result: Anchor[] = [];
    for (const p of projects) {
      for (const s of p.sources) result.push({ ...s, projectId: p.id, projectName: p.name, legacyId: `source:${p.id}:${s.id}`, sourceId: s.id, remoteUrl: p.gitRemoteUrl });
    }
    const environments = await sdk().environments.list({ ...(projectId ? { projectId } : {}), limit: 1000 });
    for (const e of environments) {
      if (e.path && e.status === "ready" && e.lifecycle.phase === "active" && e.hostLifecycle === "active") {
        const p = projects.find(p => p.id === e.projectId);
        if (p) result.push({ hostId: e.hostId, path: e.path, projectId: p.id, projectName: p.name, legacyId: e.id });
      }
    }
    return { projects, anchors: result, truncated: environments.length >= 1000 };
  }
  async function discover(projectId?: string) {
    const anchorResult = await anchors(projectId);
    const trusted = anchorResult.anchors;
    const hosts = await sdk().hosts.list();
    const rows = new Map<string, Repository>();
    const setupCandidates: SetupCandidate[] = [];
    const warnings: string[] = anchorResult.truncated ? ["Environment listing reached its 1000 row limit."] : [];
    for (const hostId of new Set(trusted.map(a => a.hostId))) {
      const host = hosts.find(h => h.id === hostId);
      if (!host || host.status !== "connected" || host.lifecycle.phase !== "active") { warnings.push(`Machine ${host?.name || hostId} is offline.`); continue; }
      const scoped = trusted.filter(a => a.hostId === hostId);
      try {
        const scan = await transport.scan(hostId, [...new Set(scoped.map(a => a.path))]);
        warnings.push(...scan.warnings.map(w => `${host.name}: ${w}`));
        if (!scan.complete && !scan.warnings.length) warnings.push(`${host.name}: discovery incomplete.`);
        const canonical = scoped.flatMap(a => {
          const proof = scan.roots.find(r => r.requestedPath === a.path);
          if (!proof) warnings.push(`${host.name}: missing root provenance for ${a.path}`);
          if (proof?.state === "missing" && a.sourceId && a.remoteUrl) {
            if (setupCandidates.length < 300) setupCandidates.push({
              id: a.legacyId, projectId: a.projectId, projectName: a.projectName, sourceId: a.sourceId,
              hostId, hostName: host.name, path: a.path, name: a.path.split("/").pop() || a.path,
              state: "missing", action: "restore",
            });
            else warnings.push("Setup candidate limit reached.");
          }
          return proof?.state === "present" && proof.canonicalPath ? [{ ...a, canonicalPath: proof.canonicalPath }] : [];
        });
        for (const identity of scan.repositories) {
          const owners = canonical.filter(a => within(identity.root, a.canonicalPath));
          if (!owners.length) continue;
          const id = key(hostId, identity);
          const prior = rows.get(id);
          const mainRoot = identity.mainRoot || (identity.commonDir.endsWith("/.git") ? identity.commonDir.slice(0, -5) : undefined);
          // Prefer the discovered main checkout; otherwise choose a stable discovered root.
          // mainRoot labels the repository, but never becomes a trusted operation target on its own.
          const preferCurrent = !prior || (identity.root === mainRoot && prior.path !== mainRoot)
            || (prior.path !== mainRoot && identity.root !== mainRoot && identity.root < prior.path);
          const representative = preferCurrent ? identity.root : prior!.path;
          const displayRoot = mainRoot || representative;
          const projectIds = [...new Set([...(prior?.projectIds || []), ...owners.map(a => a.projectId)])];
          const exact = owners.filter(a => a.canonicalPath === identity.root).map(a => a.legacyId);
          rows.set(id, {
            id, name: displayRoot.split("/").pop() || displayRoot, path: representative, hostId, hostName: host.name,
            projectIds, projectNames: [...new Set([...(prior?.projectNames || []), ...owners.map(a => a.projectName)])],
            legacyIds: [...new Set([...(prior?.legacyIds || []), ...exact])],
          });
          const bindings = owners.map(a => ({ legacyId: a.legacyId, path: a.path,
            target: a.path.replace(/\/$/, "") + identity.root.slice(a.canonicalPath.length) }));
          if (!prior) registry.set(id, { hostId, identity, projectIds, bindings });
          else {
            const record = registry.get(id)!;
            record.projectIds = projectIds;
            if (preferCurrent) {
              record.identity = identity;
              record.bindings.unshift(...bindings);
            } else record.bindings.push(...bindings);
          }
        }
      } catch (e) { warnings.push(`${host.name}: ${String(e)}`); }
    }
    const machine = hosts.filter(h => h.status === "connected" && h.lifecycle.phase === "active" && h.type === "persistent").sort((a, b) => a.createdAt - b.createdAt)[0];
    for (const p of anchorResult.projects) {
      if (p.sources.length || !p.gitRemoteUrl || p.kind === "personal" || [...rows.values()].some(r => r.projectIds?.includes(p.id))) continue;
      if (!machine) { warnings.push(`${p.name}: connect a persistent machine to prepare a checkout.`); continue; }
      if (setupCandidates.length >= 300) { warnings.push("Setup candidate limit reached."); break; }
      setupCandidates.push({ id: `setup:${p.id}:${machine.id}`, projectId: p.id, projectName: p.name,
        hostId: machine.id, hostName: machine.name, name: p.name, state: "missing", action: "clone" });
    }
    return { setupCandidates, repositories: [...rows.values()], complete: warnings.length === 0, warnings };
  }
  type CatalogResult = Awaited<ReturnType<typeof discover>>;
  const cache = new Map<string, { until: number; value: CatalogResult }>();
  const pending = new Map<string, Promise<CatalogResult>>();
  let generation = 0;
  async function catalog(projectId?: string, refresh = false): Promise<CatalogResult> {
    const scope = projectId || "*";
    const running = pending.get(scope);
    if (running) return running;
    const saved = cache.get(scope);
    if (!refresh && saved && saved.until > Date.now()) return saved.value;
    const revision = generation;
    const promise = discover(projectId).then(value => {
      if (revision !== generation) return value;
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(scope, { until: Date.now() + 10000, value });
      return value;
    }).finally(() => { if (pending.get(scope) === promise) pending.delete(scope); });
    pending.set(scope, promise);
    return promise;
  }
  async function resolve(id: string) {
    if (!/^repo:[a-f0-9]{64}$/.test(id)) throw Error("Repository selection is unknown or stale. Refresh the repository catalog.");
    let record = registry.get(id);
    if (!record) {
      // Cold restart: reconstruct solely from registered anchors, never from browser paths.
      await catalog();
      record = registry.get(id);
    }
    if (!record) throw Error("Repository selection is unknown or stale. Refresh the repository catalog.");
    const trusted = (await Promise.all(record.projectIds.map(p => anchors(p)))).flatMap(r => r.anchors);
    const binding = record.bindings.find(b => trusted.some(a =>
      a.hostId === record!.hostId && a.legacyId === b.legacyId && a.path === b.path));
    if (!binding) throw Error("Repository is no longer in a registered source or active environment.");
    const actual = await transport.identity(record.hostId, binding.target);
    if (actual.root !== record.identity.root || key(record.hostId, actual) !== id)
      throw Error("Repository identity changed. Refresh and select it again.");
    return { cwd: actual.root, hostId: record.hostId };
  }
  return { catalog, resolve, invalidate() { generation++; cache.clear(); pending.clear(); } };
}
