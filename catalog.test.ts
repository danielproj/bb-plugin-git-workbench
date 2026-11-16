import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { git } from "./git";
import { gitIdentity, scanRepositories, scanLimits } from "./catalog-host";
import { createCatalog } from "./catalog";
import { createFakeSdk, makeHostResponse } from "@get-bb/plugin-sdk/testing";
test("real nested roots, sibling clones, linked worktrees, overlap, bounds and symlink escape", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gw-catalog-"));
  try {
    const container = path.join(root, "container");
    await mkdir(container);
    const a = path.join(container, "a"), b = path.join(container, "b"), nested = path.join(a, "services", "nested");
    for (const directory of [a, b, nested]) { await mkdir(directory, { recursive: true }); await git(directory, ["init", "-q"]); }
    await git(a, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "initial"]);
    const worktree = path.join(container, "linked");
    await git(a, ["worktree", "add", "-qb", "other", worktree]);
    const outside = path.join(root, "outside"); await mkdir(outside); await git(outside, ["init", "-q"]);
    await symlink(outside, path.join(container, "escape"));
    const scan = await scanRepositories([container, a]);
    assert.equal(scan.complete, true);
    assert.equal(scan.repositories.length, 4);
    assert.equal(scan.repositories.some(r => r.root === outside), false);
    const first = await gitIdentity(a), linked = await gitIdentity(worktree), second = await gitIdentity(b);
    assert.equal(first.commonDir, linked.commonDir);
    assert.equal(first.incarnation, linked.incarnation);
    assert.notEqual(first.commonDir, second.commonDir);
    const bounded = await scanRepositories([container], undefined, { ...scanLimits, directories: 1 });
    assert.equal(bounded.complete, false);
    assert.ok(bounded.warnings.length);
    const missing = await scanRepositories([path.join(container, "missing")]);
    assert.equal(missing.complete, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
const project = { id: "p", name: "Project", kind: "standard", gitRemoteUrl: null, createdAt: 1, updatedAt: 1,
  sources: [
    { id: "s", projectId: "p", hostId: "remote", path: "/trusted", isDefault: true, type: "local_path", createdAt: 1, updatedAt: 1 },
    { id: "s2", projectId: "p", hostId: "second", path: "/trusted", isDefault: false, type: "local_path", createdAt: 1, updatedAt: 1 },
  ] };
test("fake remote SDK routes batched anchors, separates machines/clones and rejects stale/tampered IDs", async () => {
  let current = project;
  let changed = false;
  const fake = createFakeSdk({ pluginId: "git-workbench", overrides: {
    projects: { get: async () => current, list: async () => [current] },
    environments: { list: async () => [] },
    hosts: { list: async () => ["remote", "second"].map(id => makeHostResponse({ id, status: "connected" })) },
  } });
  const calls: unknown[] = [];
  const identities = ["a", "b"].map(name => ({ root: "/trusted/" + name, commonDir: "/trusted/" + name + "/.git", incarnation: "original" }));
  const service = createCatalog(() => fake.sdk, {
    scan: async (hostId, roots) => { calls.push({ hostId, roots }); return { roots: roots.map(requestedPath => ({ requestedPath, canonicalPath: requestedPath, state: "present" as const })), repositories: identities, complete: true, warnings: [] }; },
    identity: async (hostId, directory) => { calls.push({ hostId, directory }); return { ...identities.find(i => i.root === directory)!, incarnation: changed ? "replaced" : "original" }; },
  });
  const catalog = await service.catalog("p");
  assert.equal(catalog.complete, true); assert.equal(catalog.repositories.length, 4);
  assert.deepEqual(calls.slice(0, 2), [{ hostId: "remote", roots: ["/trusted"] }, { hostId: "second", roots: ["/trusted"] }]);
  const [a, b] = catalog.repositories;
  assert.notEqual(a!.id, b!.id);
  assert.deepEqual(await service.resolve(a!.id), { hostId: "remote", cwd: "/trusted/a" });
  assert.deepEqual(await service.resolve(b!.id), { hostId: "remote", cwd: "/trusted/b" });
  changed = true;
  await assert.rejects(service.resolve(a!.id), /identity changed/);
  await assert.rejects(service.resolve("repo:tampered"), /unknown or stale/);
  current = { ...project, sources: [] };
  await assert.rejects(service.resolve(b!.id), /no longer/);
  assert.equal(fake.harness.callsTo("projects.sources.add").length, 0);
});
test("partial and disconnected machines are not complete empty catalogs", async () => {
  const fake = createFakeSdk({ pluginId: "git-workbench", overrides: {
    projects: { get: async () => project }, environments: { list: async () => [] },
    hosts: { list: async () => [makeHostResponse({ id: "remote", status: "connected" })] },
  } });
  const service = createCatalog(() => fake.sdk, {
    scan: async () => ({ roots: [{ requestedPath: "/trusted", canonicalPath: "/trusted", state: "present" }], repositories: [], warnings: ["permission denied"], complete: false }),
    identity: async () => { throw Error("unexpected"); },
  });
  const result = await service.catalog("p");
  assert.equal(result.complete, false);
  assert.match(result.warnings.join(" "), /permission denied/);
  assert.match(result.warnings.join(" "), /offline/);
});
test("linked worktree catalog deduplicates identity while retaining legacy migration IDs", async () => {
  const fake = createFakeSdk({ pluginId: "git-workbench", overrides: {
    projects: { get: async () => ({ ...project, sources: [project.sources[0]!] }) },
    environments: { list: async () => [] },
    hosts: { list: async () => [makeHostResponse({ id: "remote", status: "connected" })] },
  } });
  const service = createCatalog(() => fake.sdk, {
    scan: async () => ({ roots: [{ requestedPath: "/trusted", canonicalPath: "/trusted", state: "present" }], repositories: [
      { root: "/trusted", commonDir: "/trusted/.git", incarnation: "1" },
      { root: "/trusted/linked", commonDir: "/trusted/.git", incarnation: "1" },
    ], complete: true, warnings: [] }),
    identity: async () => ({ root: "/trusted", commonDir: "/trusted/.git", incarnation: "1" }),
  });
  const result = await service.catalog("p");
  assert.equal(result.repositories.length, 1);
  assert.deepEqual(result.repositories[0]!.legacyIds, ["source:p:s"]);
  assert.deepEqual(await service.resolve(result.repositories[0]!.id), { cwd: "/trusted", hostId: "remote" });
});
test("repository name and representative root stay paired regardless of linked-worktree discovery order", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "gw-repository-name-"));
  try {
    const main = path.join(temporary, "prolepsia-app");
    await mkdir(main);
    await git(main, ["init", "-q"]);
    await git(main, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "initial"]);
    for (const name of ["buildkit-gc", "daily-copies"])
      await git(main, ["worktree", "add", "-qb", name, path.join(temporary, name)]);
    const primary = await gitIdentity(main);
    const scan = await scanRepositories([temporary]);
    assert.equal(scan.complete, true);
    assert.equal(scan.repositories.length, 3);
    const fake = createFakeSdk({ pluginId: "git-workbench", overrides: {
      projects: { get: async () => ({ ...project, name: "Unrelated project name", sources: [{ ...project.sources[0]!, path: temporary }] }) },
      environments: { list: async () => [] },
      hosts: { list: async () => [makeHostResponse({ id: "remote", status: "connected" })] },
    } });
    let order = scan.repositories;
    const service = createCatalog(() => fake.sdk, {
      scan: async () => ({ ...scan, repositories: order }),
      identity: (_host, directory) => gitIdentity(directory),
    });
    let id: string | undefined;
    for (const sorted of [scan.repositories, [...scan.repositories].reverse(), [...scan.repositories.slice(1), scan.repositories[0]!]]) {
      order = sorted;
      const result = await service.catalog("p", true);
      assert.equal(result.repositories.length, 1);
      const row = result.repositories[0]!;
      assert.equal(row.name, "prolepsia-app");
      assert.equal(row.path, primary.root);
      if (id) assert.equal(row.id, id);
      id = row.id;
      assert.deepEqual(await service.resolve(row.id), { cwd: primary.root, hostId: "remote" });
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
test("a linked-only source uses Git's main checkout name without selecting an unregistered root", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "gw-linked-name-"));
  try {
    const main = path.join(temporary, "prolepsia-app"), linked = path.join(temporary, "daily-copies");
    await mkdir(main);
    await git(main, ["init", "-q"]);
    await git(main, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "initial"]);
    await git(main, ["worktree", "add", "-qb", "topic", linked]);
    const fake = createFakeSdk({ pluginId: "git-workbench", overrides: {
      projects: { get: async () => ({ ...project, sources: [{ ...project.sources[0]!, path: linked }] }) },
      environments: { list: async () => [] },
      hosts: { list: async () => [makeHostResponse({ id: "remote", status: "connected" })] },
    } });
    const service = createCatalog(() => fake.sdk, {
      scan: (_host, roots) => scanRepositories(roots),
      identity: (_host, directory) => gitIdentity(directory),
    });
    const result = await service.catalog("p");
    assert.equal(result.complete, true);
    assert.equal(result.repositories.length, 1);
    const row = result.repositories[0]!;
    assert.equal(row.name, "prolepsia-app");
    assert.equal(row.path, (await gitIdentity(linked)).root);
    assert.deepEqual(row.legacyIds, ["source:p:s"]);
    assert.deepEqual(await service.resolve(row.id), { cwd: row.path, hostId: "remote" });
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
test("a discovered main checkout keeps its name when Git metadata is stored separately", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "gw-separate-name-"));
  try {
    const main = path.join(temporary, "prolepsia-app"), linked = path.join(temporary, "daily-copies");
    await mkdir(main);
    await git(main, ["init", "-q", "--separate-git-dir", path.join(temporary, "metadata")]);
    await git(main, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "initial"]);
    await git(main, ["worktree", "add", "-qb", "topic", linked]);
    const scan = await scanRepositories([linked, main]);
    assert.equal(scan.complete, true);
    assert.equal(scan.repositories.length, 2);
    assert.ok(scan.repositories.every(r => r.mainRoot === scan.repositories.find(r => r.root.endsWith("/prolepsia-app"))?.root));
    const fake = createFakeSdk({ pluginId: "git-workbench", overrides: {
      projects: { get: async () => ({ ...project, sources: [{ ...project.sources[0]!, path: temporary }] }) },
      environments: { list: async () => [] },
      hosts: { list: async () => [makeHostResponse({ id: "remote", status: "connected" })] },
    } });
    const service = createCatalog(() => fake.sdk, {
      scan: async () => ({ ...scan, roots: [{ requestedPath: temporary, canonicalPath: path.dirname((await gitIdentity(main)).root), state: "present" }] }),
      identity: (_host, directory) => gitIdentity(directory),
    });
    const result = await service.catalog("p");
    assert.equal(result.repositories.length, 1);
    assert.equal(result.repositories[0]!.name, "prolepsia-app");
    assert.equal(result.repositories[0]!.path, (await gitIdentity(main)).root);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
test("actual scan provenance supports ancestor aliases and rejects redirected aliases on resolution", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "gw-alias-"));
  try {
    const physical = path.join(temporary, "physical"), replacement = path.join(temporary, "replacement");
    for (const directory of [physical, replacement]) {
      await mkdir(path.join(directory, "repository"), { recursive: true });
      await git(path.join(directory, "repository"), ["init", "-q"]);
    }
    const alias = path.join(temporary, "alias");
    await symlink(physical, alias);
    const lexicalRoot = path.join(alias, "repository");
    const aliasProject = { ...project, sources: [{ ...project.sources[0]!, path: lexicalRoot }] };
    const fake = createFakeSdk({ pluginId: "git-workbench", overrides: {
      projects: { get: async () => aliasProject, list: async () => [aliasProject] },
      environments: { list: async () => [] },
      hosts: { list: async () => [makeHostResponse({ id: "remote", status: "connected" })] },
    } });
    const service = createCatalog(() => fake.sdk, {
      scan: (_host, roots) => scanRepositories(roots),
      identity: (_host, directory) => gitIdentity(directory),
    });
    const result = await service.catalog("p");
    assert.equal(result.complete, true);
    assert.equal(result.repositories.length, 1);
    const row = result.repositories[0]!;
    assert.equal(row.path, (await gitIdentity(path.join(physical, "repository"))).root);
    assert.deepEqual(row.legacyIds, ["source:p:s"]);
    assert.equal((await service.resolve(row.id)).cwd, row.path);
    await rm(alias);
    await symlink(replacement, alias);
    await assert.rejects(service.resolve(row.id), /identity changed/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
test("only registered missing sources with a known remote produce setup candidates; cache invalidation exposes restoration", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "gw-candidates-"));
  try {
    const container = path.join(temporary, "container"), missing = path.join(temporary, "missing");
    await mkdir(container);
    const candidateProject = { ...project, gitRemoteUrl: "https://example.com/repo.git", sources: [
      { ...project.sources[0]!, path: missing },
      { ...project.sources[0]!, id: "container", path: container },
    ] };
    const fake = createFakeSdk({ pluginId: "git-workbench", overrides: {
      projects: { get: async () => candidateProject },
      environments: { list: async () => [] },
      hosts: { list: async () => [makeHostResponse({ id: "remote", status: "connected" })] },
    } });
    const service = createCatalog(() => fake.sdk, {
      scan: (_host, roots) => scanRepositories(roots),
      identity: (_host, directory) => gitIdentity(directory),
    });
    const before = await service.catalog("p");
    assert.equal(before.setupCandidates.length, 1);
    assert.deepEqual(before.setupCandidates[0], {
      id: "source:p:s", projectId: "p", projectName: "Project", sourceId: "s",
      hostId: "remote", hostName: before.setupCandidates[0]!.hostName,
      path: missing, name: "missing", state: "missing", action: "restore",
    });
    assert.equal(before.repositories.length, 0);
    await mkdir(missing); await git(missing, ["init", "-q"]);
    assert.equal((await service.catalog("p")).setupCandidates.length, 1);
    service.invalidate();
    const after = await service.catalog("p");
    assert.equal(after.setupCandidates.length, 0);
    assert.equal(after.repositories.length, 1);
    assert.equal(after.complete, true);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
test("remote-only project exposes an explicit machine-bound clone candidate without scanning or cloning", async () => {
  const fake = createFakeSdk({ pluginId: "git-workbench", overrides: {
    projects: { get: async () => ({ ...project, sources: [], gitRemoteUrl: "https://example.com/repo.git" }) },
    environments: { list: async () => [] },
    hosts: { list: async () => [makeHostResponse({ id: "remote", status: "connected", type: "persistent" })] },
  } });
  const service = createCatalog(() => fake.sdk, {
    scan: async () => { throw Error("Unexpected scan"); },
    identity: async () => { throw Error("Unexpected identity"); },
  });
  const result = await service.catalog("p");
  assert.equal(result.setupCandidates.length, 1);
  assert.equal(result.setupCandidates[0]!.action, "clone");
  assert.equal(result.setupCandidates[0]!.hostId, "remote");
  assert.equal(result.setupCandidates[0]!.sourceId, undefined);
  assert.equal(fake.harness.callsTo("projects.sources.add").length, 0);
});
