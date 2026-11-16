import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeSdk, makeHostResponse } from "@get-bb/plugin-sdk/testing";
import {
  createRepositoryService as makeRepositoryService,
  sourceRepositoryId,
} from "./repositories";
const createRepositoryService = (
  sdk: Parameters<typeof makeRepositoryService>[0],
  inspect: Parameters<typeof makeRepositoryService>[1],
  restore: Parameters<typeof makeRepositoryService>[2] = async () => {
    throw Error("Unexpected checkout restore");
  },
) => makeRepositoryService(sdk, inspect, restore);
const source = {
  id: "src_one",
  projectId: "proj_one",
  hostId: "host_one",
  path: "/projects/demo",
  type: "local_path",
  isDefault: true,
  createdAt: 1,
  updatedAt: 1,
};
const project = {
  id: "proj_one",
  kind: "standard",
  name: "Demo",
  gitRemoteUrl: "https://github.com/example/demo.git",
  sources: [source],
  createdAt: 1,
  updatedAt: 1,
};
const machine = makeHostResponse({
  id: "host_one",
  name: "Workstation",
  status: "connected",
  type: "persistent",
  lifecycle: {
    phase: "active",
    message: null,
    pendingLog: "",
    suspendedAt: null,
    teardown: null,
  },
});
function fixture(
  overrides: Parameters<typeof createFakeSdk>[0]["overrides"] = {},
) {
  return createFakeSdk({
    pluginId: "git-workbench",
    overrides: {
      environments: { list: async () => [] },
      projects: { get: async () => project },
      hosts: { list: async () => [machine] },
      ...overrides,
    },
  });
}
test("automatically opens registered project sources without creating a thread or environment", async () => {
  const fake = fixture();
  const service = createRepositoryService(
    () => fake.sdk,
    async () => ({ state: "ready" }),
  );
  const rows = await service.list("proj_one");
  assert.equal(rows[0]?.id, sourceRepositoryId("proj_one", "src_one"));
  assert.deepEqual(await service.resolve(rows[0]!.id), {
    cwd: "/projects/demo",
    hostId: "host_one",
  });
  assert.equal(fake.harness.callsTo("projects.sources.add").length, 0);
  assert.equal(fake.harness.callsTo("threads.spawn").length, 0);
  service.dispose();
});
test("remote-only projects clone once through BB despite concurrent setup polling", async () => {
  let cloned = false;
  const fake = fixture({
    projects: {
      get: async () => ({ ...project, sources: cloned ? [source] : [] }),
      sources: {
        add: async () => {
          await new Promise((r) => setTimeout(r, 10));
          cloned = true;
          return source;
        },
      },
    },
  });
  const service = createRepositoryService(
    () => fake.sdk,
    async () => ({ state: "ready" }),
  );
  assert.equal((await service.setup("proj_one")).status, "preparing");
  assert.equal((await service.setup("proj_one", true)).status, "preparing");
  const result = await service.wait("proj_one");
  assert.equal(result?.status, "ready");
  assert.equal(result?.repositories[0]?.path, source.path);
  assert.deepEqual(fake.harness.callsTo("projects.sources.add"), [
    [{ projectId: "proj_one", hostId: "host_one", type: "clone" }],
  ]);
  service.dispose();
});
test("missing registered checkout restores its original path without changing its source", async () => {
  let cloned = false;
  const restored: unknown[] = [];
  const fake = fixture();
  const service = createRepositoryService(
    () => fake.sdk,
    async () => ({ state: cloned ? "ready" : "missing" }),
    async (hostId, path, remote) => {
      restored.push({ hostId, path, remote });
      cloned = true;
    },
  );
  await service.setup("proj_one");
  assert.equal((await service.wait("proj_one"))?.status, "ready");
  assert.equal(fake.harness.callsTo("projects.sources.add").length, 0);
  assert.deepEqual(restored, [
    {
      hostId: "host_one",
      path: "/projects/demo",
      remote: project.gitRemoteUrl,
    },
  ]);
  service.dispose();
});
test("an existing non-Git directory is preserved rather than replaced", async () => {
  const fake = fixture();
  const service = createRepositoryService(
    () => fake.sdk,
    async () => ({ state: "not_git" }),
  );
  await service.setup("proj_one");
  const result = await service.wait("proj_one");
  assert.equal(result?.status, "failed");
  assert.match(result!.message, /exists but is not a Git repository/);
  assert.equal(fake.harness.callsTo("projects.sources.add").length, 0);
  service.dispose();
});
test("offline configured machines are reported without cloning onto a different machine", async () => {
  const fake = fixture({
    hosts: {
      list: async () => [
        { ...machine, status: "disconnected" },
        makeHostResponse({ id: "host_other", status: "connected" }),
      ],
    },
  });
  const service = createRepositoryService(
    () => fake.sdk,
    async () => {
      throw Error("Offline host must not be probed");
    },
  );
  await service.setup("proj_one");
  const result = await service.wait("proj_one");
  assert.equal(result?.status, "failed");
  assert.match(result!.message, /offline/);
  assert.equal(fake.harness.callsTo("projects.sources.add").length, 0);
  service.dispose();
});
test("missing remotes have a specific recovery path and do not launch a clone", async () => {
  const fake = fixture({
    projects: {
      get: async () => ({ ...project, sources: [], gitRemoteUrl: null }),
    },
  });
  const service = createRepositoryService(
    () => fake.sdk,
    async () => ({ state: "missing" }),
  );
  await service.setup("proj_one");
  const result = await service.wait("proj_one");
  assert.equal(result?.status, "failed");
  assert.match(result!.message, /Add a Git remote/);
  assert.equal(fake.harness.callsTo("projects.sources.add").length, 0);
  service.dispose();
});
test("failed clones require explicit retry and transport errors remain visible", async () => {
  let attempts = 0;
  const fake = fixture({
    projects: {
      get: async () => ({ ...project, sources: [] }),
      sources: {
        add: async () => {
          attempts++;
          throw Error("Authentication failed");
        },
      },
    },
  });
  const service = createRepositoryService(
    () => fake.sdk,
    async () => ({ state: "ready" }),
  );
  await service.setup("proj_one");
  const failed = await service.wait("proj_one");
  assert.equal(failed?.status, "failed");
  assert.match(failed!.message, /Authentication failed/);
  assert.equal((await service.setup("proj_one")).status, "failed");
  assert.equal(attempts, 1);
  await service.setup("proj_one", true);
  await service.wait("proj_one");
  assert.equal(attempts, 2);
  service.dispose();
});
test("source targets are resolved from BB rather than accepting an arbitrary path", async () => {
  const fake = fixture();
  const service = createRepositoryService(
    () => fake.sdk,
    async () => ({ state: "ready" }),
  );
  await assert.rejects(
    service.resolve("source:proj_one:missing"),
    /no longer registered/,
  );
  await assert.rejects(
    service.resolve("source:proj_one:src_one:/tmp"),
    /Invalid/,
  );
  service.dispose();
  await assert.rejects(service.setup("proj_one"), /reloaded/);
});
test("source-specific setup never returns a sibling source and restores only selected machine/path", async () => {
  const other = { ...source, id: "src_two", hostId: "host_two", path: "/other/checkout" };
  let restored = false;
  const fake = fixture({
    projects: { get: async () => ({ ...project, sources: [source, other] }) },
    hosts: { list: async () => [machine, makeHostResponse({ id: "host_two", status: "connected" })] },
  });
  const restores: unknown[] = [];
  const service = makeRepositoryService(
    () => fake.sdk,
    async (hostId) => ({ state: hostId === "host_one" || restored ? "ready" : "missing" }),
    async (hostId, path) => { restores.push({ hostId, path }); restored = true; },
  );
  await service.setup("proj_one", false, "src_two");
  const job = await service.wait("proj_one", "src_two");
  assert.equal(job?.status, "ready");
  assert.equal(job?.repositories[0]?.path, other.path);
  assert.deepEqual(restores, [{ hostId: "host_two", path: other.path }]);
});
test("remote-only setup honors explicit candidate host rather than oldest connected host", async () => {
  const fake = fixture({
    projects: {
      get: async () => ({ ...project, sources: [] }),
      sources: { add: async () => ({ ...source, hostId: "host_two" }) },
    },
    hosts: { list: async () => [machine, makeHostResponse({ id: "host_two", status: "connected", type: "persistent" })] },
  });
  const service = makeRepositoryService(() => fake.sdk, async () => ({ state: "ready" }), async () => {});
  await service.setup("proj_one", false, undefined, "host_two");
  assert.equal((await service.wait("proj_one", undefined, "host_two"))?.status, "ready");
  assert.deepEqual(fake.harness.callsTo("projects.sources.add"), [[{ projectId: "proj_one", hostId: "host_two", type: "clone" }]]);
});
test("setup validates host binding during an in-flight job and after readiness", async () => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const fake = fixture();
  const service = makeRepositoryService(() => fake.sdk, async () => {
    await gate; return { state: "ready" };
  }, async () => { throw Error("Unexpected restore"); });
  await service.setup("proj_one", false, "src_one", "host_one");
  assert.equal((await service.setup("proj_one", true, "src_one", "host_other")).status, "failed");
  release();
  assert.equal((await service.wait("proj_one", "src_one", "host_one"))?.status, "ready");
  assert.equal((await service.setup("proj_one", false, "src_one", "host_other")).status, "failed");
  assert.equal((await service.setup("proj_one", false, "src_one", "host_one")).status, "ready");
  assert.equal(fake.harness.callsTo("projects.sources.add").length, 0);
});
test("ready setup cache is invalidated by source path changes and removal", async () => {
  let current = project;
  const fake = fixture({ projects: { get: async () => current } });
  const service = makeRepositoryService(() => fake.sdk, async () => ({ state: "ready" }), async () => {});
  await service.setup("proj_one", false, "src_one", "host_one");
  await service.wait("proj_one", "src_one", "host_one");
  current = { ...project, sources: [{ ...source, path: "/new/root", updatedAt: 2 }] };
  assert.equal((await service.setup("proj_one", false, "src_one", "host_one")).status, "preparing");
  assert.equal((await service.wait("proj_one", "src_one", "host_one"))?.repositories[0]?.path, "/new/root");
  current = { ...project, sources: [] };
  assert.equal((await service.setup("proj_one", false, "src_one", "host_one")).status, "failed");
});
test("preparing setup cannot be acknowledged after its source moves machines or is removed", async () => {
  let current = project;
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const fake = fixture({ projects: { get: async () => current } });
  const service = makeRepositoryService(() => fake.sdk, async () => { await gate; return { state: "ready" }; }, async () => {});
  await service.setup("proj_one", false, "src_one", "host_one");
  current = { ...project, sources: [{ ...source, hostId: "host_other" }] };
  assert.equal((await service.setup("proj_one", false, "src_one", "host_one")).status, "failed");
  current = { ...project, sources: [] };
  assert.equal((await service.setup("proj_one", true, "src_one", "host_one")).status, "failed");
  release();
  await service.wait("proj_one", "src_one", "host_one");
  assert.equal((await service.setup("proj_one", false, "src_one", "host_one")).status, "failed");
  assert.equal(fake.harness.callsTo("projects.sources.add").length, 0);
});
