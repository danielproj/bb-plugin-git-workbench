import { createCatalog } from "./catalog";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createRepositoryService } from "./repositories";
import { hostContract, rpcContract } from "./contract";
import {createCloneService} from './clone-service';
export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const repositories = createRepositoryService(
    () => bb.sdk,
    (hostId, path) => host.call("inspectCheckout", { path }, { hostId }),
    (hostId, path, remoteUrl) =>
      host.call(
        "restoreCheckout",
        { path, remoteUrl },
        { hostId, timeoutMs: 330000 },
      ),
  );
  const catalog = createCatalog(() => bb.sdk, {
    scan: (hostId, roots) => host.call("scanRepositories", { roots }, { hostId, timeoutMs: 25000 }),
    identity: (hostId, path) => host.call("gitIdentity", { path }, { hostId }),
  });
  bb.onDispose(() => repositories.dispose());
  const clones=createCloneService(()=>bb.sdk,{
    directory:(hostId,signal)=>host.call('cloneDirectory',{}, {hostId,signal,timeoutMs:10000}),
    clone:(hostId,path,remoteUrl,signal)=>host.call('cloneRepository',{path,remoteUrl},{hostId,signal,timeoutMs:330000}),
    verify:(hostId,identity,remoteUrl,signal)=>host.call('verifyClone',{identity,remoteUrl},{hostId,signal}),
    catalog:projectId=>{catalog.invalidate();return catalog.catalog(projectId,true);},
    resolve:id=>catalog.resolve(id),
  });
  bb.onDispose(()=>clones.dispose());
  async function repository(environmentId: string, worktreePath?: string) {
    const e = environmentId.startsWith("repo:")
      ? await catalog.resolve(environmentId)
      : await repositories.resolve(environmentId);
    const cwd = worktreePath
      ? (
          await host.call(
            "resolveWorktree",
            { cwd: e.cwd, path: worktreePath },
            { hostId: e.hostId },
          )
        ).cwd
      : e.cwd;
    return { cwd, hostId: e.hostId };
  }
  bb.rpc.register(rpcContract, {
    cloneOptions: (_input,ctx)=>clones.options(ctx.experimental_signal),
    cloneStart: input=>clones.start(input),
    cloneStatus: ({id})=>clones.status(id),
    prList: async ({environmentId,worktreePath,query},ctx) => {const {cwd,hostId}=await repository(environmentId,worktreePath);return host.call('prList',{cwd,query},{hostId,signal:ctx.experimental_signal,timeoutMs:180000});},
    prRead: async ({environmentId,worktreePath,read},ctx) => {const {cwd,hostId}=await repository(environmentId,worktreePath);return host.call('prRead',{cwd,read},{hostId,signal:ctx.experimental_signal,timeoutMs:180000});},
    prMutate: async ({environmentId,worktreePath,op},ctx) => {const {cwd,hostId}=await repository(environmentId,worktreePath);try{return await host.call('prMutate',{cwd,op},{hostId,signal:ctx.experimental_signal,timeoutMs:180000});}finally{bb.realtime.publish('changed',{environmentId});}},
    projects: async () =>
      (await bb.sdk.projects.list({ includePersonal: true })).map((p) => ({
        id: p.id,
        name: p.name,
      })),
    catalog: ({ projectId, refresh }) => catalog.catalog(projectId, refresh),
    repositories: async ({ projectId }) => (await catalog.catalog(projectId)).repositories,
    setupCheckout: ({ projectId, retry, sourceId, hostId }) => {
      catalog.invalidate();
      return repositories.setup(projectId, retry, sourceId, hostId);
    },
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
