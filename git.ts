import { spawn } from "node:child_process";
import path from "node:path";
import type { Operation, Query, Read, Snapshot } from "./contract";
export function ref(v: string) {
  if (!v || v.startsWith("-") || /[\x00-\x20]/.test(v))
    throw Error("Enter a valid Git reference.");
  return v;
}
export function filePath(v: string) {
  if (
    !v ||
    path.isAbsolute(v) ||
    v.split(/[\\/]/).includes("..") ||
    v.includes("\0")
  )
    throw Error("File path must stay inside the repository.");
  return v;
}
export async function git(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
  input?: string,
  allowFailure = false,
  timeoutMs = 60000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      [
        "--no-pager",
        "--literal-pathspecs",
        "-c",
        "color.ui=false",
        "-c",
        "core.quotepath=false",
        ...args,
      ],
      {
        cwd,
        signal,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_EDITOR: "true",
          GIT_SEQUENCE_EDITOR: "false",
          LC_ALL: "C",
        },
      },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    let overflow = false;
    const append = (b: Buffer) => {
      size += b.length;
      if (size > 4 * 1024 * 1024) {
        overflow = true;
        child.kill();
      } else chunks.push(b);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const text = Buffer.concat(chunks).toString("utf8");
      if (overflow)
        reject(Error("Git output exceeds 4 MiB. Narrow the filter."));
      else if (code !== 0 && !allowFailure)
        reject(Error(text.trim() || "Git was interrupted or timed out."));
      else resolve(text);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
export function parseStatus(raw: string): Snapshot["files"] {
  const tokens = raw.split("\0");
  const files: Snapshot["files"] = [];
  for (let i = 0; i < tokens.length; i++) {
    const s = tokens[i];
    if (!s) continue;
    const index = s[0]!,
      worktree = s[1]!,
      p = s.slice(3);
    let original: string | undefined;
    if (/[RC]/.test(index + worktree)) original = tokens[++i];
    files.push({
      path: p,
      index,
      worktree,
      ...(original ? { original } : {}),
      conflict: ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(
        index + worktree,
      ),
    });
  }
  return files;
}
export async function getSnapshot(
  cwd: string,
  q: Query,
  signal?: AbortSignal,
): Promise<Snapshot> {
  const run = (args: string[], allow = false) =>
    git(cwd, args, signal, undefined, allow);
  const root = (await run(["rev-parse", "--show-toplevel"])).trim();
  const branch =
    (await run(["symbolic-ref", "--short", "-q", "HEAD"], true)).trim() ||
    "Detached HEAD";
  const unborn = (
    await run(["rev-parse", "--verify", "HEAD"], true)
  ).startsWith("fatal:");
  const upstream = await run(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    true,
  );
  const up = upstream.startsWith("fatal:") ? "" : upstream.trim();
  const counts = up
    ? (await run(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]))
        .trim()
        .split(/\s+/)
        .map(Number)
    : [0, 0];
  const args = [
    "log",
    "--topo-order",
    `--max-count=${q.limit}`,
    "--format=%H%x00%P%x00%s%x00%an%x00%aI%x00%D%x00",
  ];
  if (q.search && !/^[a-f0-9]{7,40}$/i.test(q.search))
    args.push("--fixed-strings", `--grep=${q.search}`);
  if (q.author) args.push(`--author=${q.author}`);
  if (q.since) args.push(`--since=${q.since}`);
  args.push(
    /^[a-f0-9]{7,40}$/i.test(q.search)
      ? ref(q.search)
      : q.branch
        ? ref(q.branch)
        : "--all",
  );
  if (q.path) args.push("--", filePath(q.path));
  const log = unborn ? "" : await run(args);
  const tokens = log.split("\0");
  const commits: Snapshot["commits"] = [];
  for (let i = 0; i + 5 < tokens.length; i += 6)
    commits.push({
      sha: tokens[i]!.trim(),
      parents: tokens[i + 1]!.split(" ").filter(Boolean),
      subject: tokens[i + 2]!,
      author: tokens[i + 3]!,
      date: tokens[i + 4]!,
      refs: tokens[i + 5]!,
    });
  const refs = (
    await run([
      "for-each-ref",
      "--format=%(refname)%09%(HEAD)%09%(upstream:short)",
      "refs/heads",
      "refs/remotes",
      "refs/tags",
    ])
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((s) => {
      const [full = "", head = "", upstream = ""] = s.split("\t");
      return {
        name: full.replace(/^refs\/(heads|remotes|tags)\//, ""),
        kind: full.split("/")[1]!,
        current: head === "*",
        upstream,
      };
    });
  const stashes = (await run(["stash", "list", "--format=%gd%x09%s"]))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((s) => {
      const [ref = "", ...subject] = s.split("\t");
      return { ref, subject: subject.join("\t") };
    });
  const op = (await run(["status", "--untracked-files=no"]))
    .split("\n")
    .filter((s) => /rebas|merg|cherry.pick|conflict/i.test(s))
    .join("\n");
  return {
    root,
    branch,
    upstream: up,
    ahead: counts[0] || 0,
    behind: counts[1] || 0,
    files: parseStatus(
      await run(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    ),
    commits,
    refs,
    stashes,
    remotes: await run(["remote", "-v"]),
    worktrees: await run(["worktree", "list", "--porcelain"]),
    operation: op,
  };
}
export function bounded(text: string) {
  return { text: text.slice(0, 500000), truncated: text.length > 500000 };
}
export async function readGit(cwd: string, r: Read, signal?: AbortSignal) {
  let a: string[];
  switch (r.kind) {
    case "commit-files":
      return bounded(
        JSON.stringify(
          (
            await git(
              cwd,
              [
                "diff-tree",
                "--first-parent",
                "-m",
                "--root",
                "--no-commit-id",
                "--name-only",
                "-r",
                "-z",
                ref(r.value),
                "--",
              ],
              signal,
            )
          )
            .split("\0")
            .filter(Boolean),
        ),
      );
    case "commit":
      a = [
        "show",
        "--first-parent",
        "--no-ext-diff",
        "--no-textconv",
        "--format=fuller",
        "--stat",
        "--patch",
        ref(r.value),
        "--",
        ...(r.path ? [filePath(r.path)] : []),
      ];
      break;
    case "blame":
      a = ["blame", "--date=short", "--", filePath(r.path)];
      break;
    case "history":
      a = [
        "log",
        "-100",
        "--follow",
        "--format=fuller",
        "--stat",
        "--",
        filePath(r.path),
      ];
      break;
    case "reflog":
      a = ["reflog", "-200", "--date=iso"];
      break;
    case "stash":
      a = ["stash", "show", "-p", ref(r.value)];
      break;
    default:
      a = [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        ...(r.staged ? ["--cached"] : []),
        ...(r.ignoreWhitespace ? ["-w"] : []),
        "--",
        ...(r.path ? [filePath(r.path)] : []),
      ];
  }
  if (r.kind === "diff" && r.path && !r.staged) {
    const status = parseStatus(
      await git(
        cwd,
        ["status", "--porcelain=v1", "-z", "--", filePath(r.path)],
        signal,
      ),
    );
    if (status.some((f) => f.index === "?"))
      return bounded(
        await git(
          cwd,
          [
            "diff",
            "--no-index",
            "--no-ext-diff",
            "--",
            "/dev/null",
            filePath(r.path),
          ],
          signal,
          undefined,
          true,
        ),
      );
  }
  return bounded(await git(cwd, a, signal));
}
export const destructive = new Set([
  "discard",
  "branch-delete",
  "tag-delete",
  "stash-drop",
  "remote-remove",
  "worktree-remove",
  "reset",
]);
export async function mutateGit(
  cwd: string,
  o: Operation,
  signal?: AbortSignal,
) {
  if (destructive.has(o.action) && !o.confirmed)
    throw Error("Confirm this operation before proceeding.");
  const p = o.paths.map(filePath);
  const v = () => ref(o.value);
  let a: string[];
  let input: string | undefined;
  switch (o.action) {
    case "stage":
      if (!p.length) throw Error("Select files to stage.");
      a = ["add", "--", ...p];
      break;
    case "unstage":
      if (!p.length) throw Error("Select files to unstage.");
      {
        const head = await git(
          cwd,
          ["rev-parse", "--verify", "HEAD"],
          signal,
          undefined,
          true,
        );
        a = head.startsWith("fatal:")
          ? ["rm", "--cached", "--", ...p]
          : ["restore", "--staged", "--", ...p];
      }
      break;
    case "discard":
      if (!p.length) throw Error("Select tracked files.");
      a = ["restore", "--worktree", "--", ...p];
      break;
    case "commit":
      if (!o.value.trim()) throw Error("Enter a commit message.");
      a = ["commit", ...(o.flag ? ["--amend"] : []), "-m", o.value];
      break;
    case "fetch":
      a = ["fetch", "--all", "--prune"];
      break;
    case "pull":
      a = ["pull", o.flag ? "--rebase" : "--ff-only"];
      break;
    case "push":
      a = [
        "push",
        ...(o.flag ? ["--force-with-lease"] : []),
        ...(o.value
          ? ["--set-upstream", v(), ...(o.extra ? [ref(o.extra)] : [])]
          : []),
      ];
      break;
    case "checkout":
      await git(cwd, ["show-ref", "--verify", `refs/heads/${v()}`], signal);
      a = ["switch", "--no-guess", "--no-overwrite-ignore", v()];
      break;
    case "branch-create":
      a = ["switch", "--no-overwrite-ignore", "-c", v(), ...(o.extra ? [ref(o.extra)] : [])];
      break;
    case "checkout-remote":
      await git(cwd, ["show-ref", "--verify", `refs/remotes/${v()}`], signal);
      a = ["switch", "--no-overwrite-ignore", "--track", "-c", ref(o.extra), `refs/remotes/${v()}`];
      break;
    case "branch-delete":
      a = ["branch", "-d", v()];
      break;
    case "branch-rename":
      a = ["branch", "-m", v()];
      break;
    case "merge":
      a = ["merge", "--no-edit", v()];
      break;
    case "rebase":
      a = ["rebase", v()];
      break;
    case "cherry-pick":
      a = ["cherry-pick", v()];
      break;
    case "revert":
      a = ["revert", "--no-edit", v()];
      break;
    case "reset":
      a = ["reset", `--${o.mode}`, v()];
      break;
    case "tag-create":
      a = ["tag", ...(o.extra ? ["-a", "-m", o.extra] : []), v()];
      break;
    case "tag-delete":
      a = ["tag", "-d", v()];
      break;
    case "stash-save":
      a = [
        "stash",
        "push",
        "--include-untracked",
        ...(o.value ? ["-m", o.value] : []),
      ];
      break;
    case "stash-apply":
    case "stash-pop":
    case "stash-drop":
      a = ["stash", o.action.slice(6), v()];
      break;
    case "remote-add":
    case "remote-url": {
      if (
        !/^(https?:\/\/|ssh:\/\/|git@|\/)/.test(o.extra) ||
        o.extra.startsWith("-")
      )
        throw Error("Use an HTTPS, SSH, or absolute local remote URL.");
      a = [
        "remote",
        o.action === "remote-add" ? "add" : "set-url",
        v(),
        o.extra,
      ];
      break;
    }
    case "remote-remove":
      a = ["remote", "remove", v()];
      break;
    case "worktree-add":
      if (!path.isAbsolute(o.value))
        throw Error("Enter an absolute worktree path.");
      a = [
        "worktree",
        "add",
        ...(o.flag ? ["-b", ref(o.extra)] : []),
        "--",
        o.value,
        ...(!o.flag && o.extra ? [ref(o.extra)] : []),
      ];
      break;
    case "worktree-remove":
      if (!path.isAbsolute(o.value))
        throw Error("Enter an absolute worktree path.");
      a = ["worktree", "remove", "--", o.value];
      break;
    case "worktree-prune":
      a = ["worktree", "prune"];
      break;
    case "ours":
    case "theirs":
      if (!p.length) throw Error("Select a conflicted file.");
      a = ["checkout", `--${o.action}`, "--", ...p];
      break;
    case "merge-abort":
    case "rebase-abort":
    case "rebase-continue":
    case "cherry-pick-abort":
    case "cherry-pick-continue": {
      const idx = o.action.lastIndexOf("-");
      a = [o.action.slice(0, idx), `--${o.action.slice(idx + 1)}`];
      break;
    }
    case "apply-patch":
      if (!o.patch.trim()) throw Error("Enter a unified patch.");
      a = ["apply", ...(o.flag ? ["--cached"] : []), "-"];
      input = o.patch;
      break;
    default:
      throw Error("Unsupported operation");
  }
  return bounded(await git(cwd, a, signal, input));
}
