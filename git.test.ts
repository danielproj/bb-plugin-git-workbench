import { realpath } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  git,
  getSnapshot,
  mutateGit,
  readGit,
  parseStatus,
  filePath,
  ref,
} from "./git";
import { operation } from "./contract";
import { layoutGraph, diffHunks } from "./graph";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import host from "./host";
const query = {
  search: "",
  branch: "",
  author: "",
  path: "",
  since: "",
  limit: 200,
};
async function fixture(fn: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(tmpdir(), "gw-test-"));
  try {
    await git(cwd, ["init", "-b", "main"]);
    await git(cwd, ["config", "user.name", "Test"]);
    await git(cwd, ["config", "user.email", "test@example.com"]);
    await git(cwd, ["config", "commit.gpgsign", "false"]);
    await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
const op = (action: string, fields: object = {}) =>
  operation.parse({ action, ...fields });
test("unborn repositories support stage, unstage, commit and amend", () =>
  fixture(async (cwd) => {
    await writeFile(path.join(cwd, "first.txt"), "one\n");
    let s = await getSnapshot(cwd, query);
    assert.equal(s.commits.length, 0);
    assert.equal(s.files[0]?.index, "?");
    await mutateGit(cwd, op("stage", { paths: ["first.txt"] }));
    await mutateGit(cwd, op("unstage", { paths: ["first.txt"] }));
    assert.equal((await getSnapshot(cwd, query)).files[0]?.index, "?");
    await mutateGit(cwd, op("stage", { paths: ["first.txt"] }));
    await mutateGit(cwd, op("commit", { value: "Initial" }));
    await mutateGit(cwd, op("commit", { value: "Amended", flag: true }));
    s = await getSnapshot(cwd, query);
    assert.equal(s.commits.length, 1);
    assert.equal(s.commits[0]?.subject, "Amended");
    assert.equal(s.files.length, 0);
  }));
test("NUL status preserves whitespace, newlines and rename identity", () => {
  const s = parseStatus("R  new name\0old name\0?? line\nbreak\0");
  assert.equal(s[0]?.original, "old name");
  assert.equal(s[0]?.path, "new name");
  assert.equal(s[1]?.path, "line\nbreak");
});
test("rejects flags and file escapes at mutation boundary", () =>
  fixture(async (cwd) => {
    assert.throws(() => ref("--upload-pack=bad"));
    assert.throws(() => filePath("../escape"));
    assert.throws(() => filePath("/tmp/escape"));
    await assert.rejects(mutateGit(cwd, op("stage")));
    await assert.rejects(
      mutateGit(cwd, op("reset", { value: "HEAD" })),
      /Confirm/,
    );
    await assert.rejects(
      mutateGit(cwd, op("remote-add", { value: "origin", extra: "ext::evil" })),
      /HTTPS/,
    );
  }));
test("untracked diff and hunk staging preserve other unstaged edits", () =>
  fixture(async (cwd) => {
    await writeFile(
      path.join(cwd, "a.txt"),
      Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n") + "\n",
    );
    assert.match(
      (
        await readGit(cwd, {
          kind: "diff",
          value: "",
          path: "a.txt",
          staged: false,
          ignoreWhitespace: false,
        })
      ).text,
      /\+line 0/,
    );
    await mutateGit(cwd, op("stage", { paths: ["a.txt"] }));
    await mutateGit(cwd, op("commit", { value: "Base" }));
    await writeFile(
      path.join(cwd, "a.txt"),
      Array.from({ length: 30 }, (_, i) =>
        i === 1
          ? "changed near start"
          : i === 28
            ? "changed near end"
            : `line ${i}`,
      ).join("\n") + "\n",
    );
    const d = await readGit(cwd, {
      kind: "diff",
      value: "",
      path: "a.txt",
      staged: false,
      ignoreWhitespace: false,
    });
    const hunks = diffHunks(d.text);
    assert.equal(hunks.length, 2);
    await mutateGit(cwd, op("apply-patch", { flag: true, patch: hunks[0] }));
    const staged = await git(cwd, ["diff", "--cached"]);
    assert.match(staged, /changed near start/);
    assert.doesNotMatch(staged, /changed near end/);
    assert.match(await git(cwd, ["diff"]), /changed near end/);
  }));
test("branches, annotated tags, filters and ancestry", () =>
  fixture(async (cwd) => {
    await writeFile(path.join(cwd, "a"), "base");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "Base"]);
    await mutateGit(cwd, op("branch-create", { value: "feature" }));
    await writeFile(path.join(cwd, "a"), "feature");
    await git(cwd, ["commit", "-am", "Feature subject"]);
    await mutateGit(cwd, op("tag-create", { value: "v1", extra: "Release" }));
    let s = await getSnapshot(cwd, query);
    assert.equal(s.branch, "feature");
    assert.ok(s.refs.some((r) => r.name === "v1" && r.kind === "tags"));
    assert.equal(s.commits[0]?.parents[0], s.commits[1]?.sha);
    assert.equal(
      (await getSnapshot(cwd, { ...query, search: "Feature subject" })).commits
        .length,
      1,
    );
    assert.equal(
      (await getSnapshot(cwd, { ...query, search: s.commits[0]!.sha }))
        .commits[0]?.subject,
      "Feature subject",
    );
    assert.equal(layoutGraph(s.commits).length, 2);
  }));
test("stash and tracked discard alter only the requested files", () =>
  fixture(async (cwd) => {
    await writeFile(path.join(cwd, "a"), "base");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "Base"]);
    await writeFile(path.join(cwd, "a"), "changed");
    await mutateGit(cwd, op("stash-save", { value: "Work" }));
    assert.equal((await getSnapshot(cwd, query)).stashes.length, 1);
    await mutateGit(cwd, op("stash-pop", { value: "stash@{0}" }));
    assert.equal(await readFile(path.join(cwd, "a"), "utf8"), "changed");
    await mutateGit(cwd, op("discard", { paths: ["a"], confirmed: true }));
    assert.equal(await readFile(path.join(cwd, "a"), "utf8"), "base");
  }));
test("real merge conflicts remain visible and can be resolved", () =>
  fixture(async (cwd) => {
    await writeFile(path.join(cwd, "a"), "base\n");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "Base"]);
    await mutateGit(cwd, op("branch-create", { value: "feature" }));
    await writeFile(path.join(cwd, "a"), "feature\n");
    await git(cwd, ["commit", "-am", "Feature"]);
    await mutateGit(cwd, op("checkout", { value: "main" }));
    await writeFile(path.join(cwd, "a"), "main\n");
    await git(cwd, ["commit", "-am", "Main"]);
    await assert.rejects(mutateGit(cwd, op("merge", { value: "feature" })));
    assert.equal((await getSnapshot(cwd, query)).files[0]?.conflict, true);
    await mutateGit(cwd, op("theirs", { paths: ["a"] }));
    await mutateGit(cwd, op("stage", { paths: ["a"] }));
    await mutateGit(cwd, op("commit", { value: "Resolve merge" }));
    assert.equal(await readFile(path.join(cwd, "a"), "utf8"), "feature\n");
    const sha = (await getSnapshot(cwd, query)).commits[0]!.sha;
    assert.deepEqual(
      JSON.parse(
        (
          await readGit(cwd, {
            kind: "commit-files",
            value: sha,
            path: "",
            staged: false,
            ignoreWhitespace: false,
          })
        ).text,
      ),
      ["a"],
    );
  }));
test("host contract runs against actual Git and validates inputs", () =>
  fixture(async (cwd) => {
    const h = experimental_createHostEntryHarness(host);
    try {
      await writeFile(path.join(cwd, "untracked"), "data");
      const s = await h.experimental_call("snapshot", { cwd, query });
      assert.equal(s.branch, "main");
      assert.equal(s.files[0]?.path, "untracked");
      await assert.rejects(
        h.experimental_call("mutate", {
          cwd,
          // @ts-expect-error Deliberately invalid wire input must be rejected.
          op: { action: "arbitrary-shell" },
        }),
      );
    } finally {
      await h.experimental_dispose();
    }
  }));
test("linked worktree creation and removal", () =>
  fixture(async (cwd) => {
    await writeFile(path.join(cwd, "a"), "base");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "Base"]);
    const dest = path.join(cwd, "linked");
    await mutateGit(
      cwd,
      op("worktree-add", { value: dest, extra: "linked", flag: true }),
    );
    assert.match(
      (await getSnapshot(cwd, query)).worktrees,
      /refs\/heads\/linked/,
    );
    await mutateGit(
      cwd,
      op("worktree-remove", { value: dest, confirmed: true }),
    );
    assert.doesNotMatch(
      (await getSnapshot(cwd, query)).worktrees,
      /refs\/heads\/linked/,
    );
  }));
test("local remote fetch, push and pull", () =>
  fixture(async (cwd) => {
    const bare = path.join(cwd, "remote.git");
    await mkdir(bare);
    await git(bare, ["init", "--bare"]);
    await writeFile(path.join(cwd, "a"), "base");
    await git(cwd, ["add", "a"]);
    await git(cwd, ["commit", "-m", "Base"]);
    await mutateGit(cwd, op("remote-add", { value: "origin", extra: bare }));
    await mutateGit(cwd, op("push", { value: "origin", extra: "main" }));
    await mutateGit(cwd, op("fetch"));
    await mutateGit(cwd, op("pull"));
    assert.equal((await getSnapshot(cwd, query)).upstream, "origin/main");
  }));

test("commit file lists and path-scoped previews preserve identity", () =>
  fixture(async (cwd) => {
    await writeFile(path.join(cwd, "one file"), "first");
    await writeFile(path.join(cwd, "second"), "second");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "Two files"]);
    const sha = (await getSnapshot(cwd, query)).commits[0]!.sha;
    const base = {
      value: sha,
      path: "",
      staged: false,
      ignoreWhitespace: false,
    };
    assert.deepEqual(
      JSON.parse((await readGit(cwd, { ...base, kind: "commit-files" })).text),
      ["one file", "second"],
    );
    const d = await readGit(cwd, { ...base, kind: "commit", path: "one file" });
    assert.match(d.text, /\+first/);
    assert.doesNotMatch(d.text, /\+second/);
  }));
test("rebase, revert and reset preserve their documented scopes", () =>
  fixture(async (cwd) => {
    await writeFile(path.join(cwd, "base"), "base");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "Base"]);
    await mutateGit(cwd, op("branch-create", { value: "feature" }));
    await writeFile(path.join(cwd, "feature"), "feature");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "Feature"]);
    await mutateGit(cwd, op("checkout", { value: "main" }));
    await writeFile(path.join(cwd, "main"), "main");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "Main"]);
    await mutateGit(cwd, op("checkout", { value: "feature" }));
    await mutateGit(cwd, op("rebase", { value: "main" }));
    assert.equal(
      (await getSnapshot(cwd, query)).commits[0]?.subject,
      "Feature",
    );
    await mutateGit(cwd, op("revert", { value: "HEAD" }));
    assert.equal((await getSnapshot(cwd, query)).files.length, 0);
    await mutateGit(
      cwd,
      op("reset", { value: "HEAD~1", mode: "soft", confirmed: true }),
    );
    assert.equal((await getSnapshot(cwd, query)).files[0]?.index, "D");
  }));

test("imports only public SDK and declared React surface", async () => {
  const { experimental_scanPublicSdkOnly } =
    await import("@get-bb/plugin-sdk/testing");
  const report = experimental_scanPublicSdkOnly(process.cwd(), {
    allow: [/^react$/, /^react-dom\/client$/, /^jsdom$/],
  });
  assert.deepEqual(report.violations, []);
  assert.deepEqual(report.privateDependencies, []);
});

test("host worktree selection refuses unrelated directories and accepts linked checkouts", () =>
  fixture(async (cwd) => {
    await writeFile(path.join(cwd, "a"), "base");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "Base"]);
    const dest = path.join(cwd, "linked");
    await mutateGit(
      cwd,
      op("worktree-add", { value: dest, extra: "linked", flag: true }),
    );
    const h = experimental_createHostEntryHarness(host);
    try {
      assert.equal(
        (await h.experimental_call("resolveWorktree", { cwd, path: dest })).cwd,
        await realpath(dest),
      );
      await assert.rejects(
        h.experimental_call("resolveWorktree", { cwd, path: tmpdir() }),
        /not part/,
      );
    } finally {
      await h.experimental_dispose();
    }
  }));
