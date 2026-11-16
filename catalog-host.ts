import { lstat, realpath, opendir } from "node:fs/promises";
import path from "node:path";
import { git } from "./git";
export type GitIdentity = { root: string; commonDir: string; incarnation: string };
export type ScannedRepository = GitIdentity & { mainRoot?: string };
export type RootProvenance = { requestedPath: string; canonicalPath?: string; state: "present" | "missing" | "error" };
export type ScanResult = { roots: RootProvenance[]; repositories: ScannedRepository[]; warnings: string[]; complete: boolean };
export const scanLimits = { directories: 5000, repositories: 300, depth: 8, milliseconds: 15000 };
const skipped = new Set([".git", "node_modules", ".cache", ".venv", "venv", "__pycache__", ".next", ".turbo"]);
export async function gitIdentity(directory: string, signal?: AbortSignal): Promise<GitIdentity> {
  const root = await realpath(directory);
  const top = await realpath((await git(root, ["rev-parse", "--show-toplevel"], signal)).trim());
  if (top !== root) throw Error("Selected path is not a Git root.");
  const commonDir = await realpath((await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"], signal)).trim());
  const info = await lstat(commonDir);
  return { root, commonDir, incarnation: `${info.dev}:${info.ino}:${info.birthtimeMs}` };
}
export async function scanRepositories(roots: string[], signal?: AbortSignal, limits = scanLimits): Promise<ScanResult> {
  const repositories: ScannedRepository[] = [], warnings: string[] = [];
  const mainRoots = new Map<string, string>();
  const provenance: RootProvenance[] = [];
  const seen = new Set<string>();
  let entries = 0;
  const deadline = Date.now() + limits.milliseconds;
  const bounded = AbortSignal.timeout(limits.milliseconds);
  const abort = signal ? AbortSignal.any([signal, bounded]) : bounded;
  const queue: { directory: string; depth: number }[] = [];
  for (const root of [...new Set(roots)].sort()) {
    try {
      if ((await lstat(root)).isSymbolicLink()) throw Error("Symlink anchor is not scanned.");
      const canonicalPath = await realpath(root);
      provenance.push({ requestedPath: root, canonicalPath, state: "present" });
      queue.push({ directory: canonicalPath, depth: 0 });
    } catch (e) {
      provenance.push({ requestedPath: root, state: (e as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "error" });
      warnings.push(`${root}: ${String(e)}`);
    }
  }
  while (queue.length) {
    if (Date.now() >= deadline || seen.size >= limits.directories || repositories.length >= limits.repositories || abort.aborted) {
      warnings.push("Discovery limit reached; refresh or narrow the project scope."); break;
    }
    const { directory, depth } = queue.shift()!;
    if (seen.has(directory)) continue;
    seen.add(directory);
    try {
      const marker = await lstat(path.join(directory, ".git")).catch((e) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
      if (marker) {
        const identity = await gitIdentity(directory, abort);
        const gitDir = await realpath((await git(directory, ["rev-parse", "--absolute-git-dir"], abort)).trim());
        let mainRoot = mainRoots.get(identity.commonDir);
        if (gitDir === identity.commonDir) {
          mainRoot = identity.root;
          mainRoots.set(identity.commonDir, mainRoot);
        } else if (!mainRoot) {
          // Git lists the main checkout first. This is display metadata, not a scan anchor.
          const first = (await git(directory, ["worktree", "list", "--porcelain", "-z"], abort)).split("\0")[0]!;
          if (!first.startsWith("worktree ") || !path.isAbsolute(first.slice(9)))
            throw Error("Git did not identify the repository's main checkout.");
          mainRoot = first.slice(9);
          mainRoots.set(identity.commonDir, mainRoot);
        }
        repositories.push({ ...identity, mainRoot });
      }
      const handle = await opendir(directory);
      for await (const child of handle) {
        if (++entries > 50000 || Date.now() >= deadline || abort.aborted) {
          warnings.push("Entry or time limit reached."); queue.length = 0; break;
        }
        if (!child.isDirectory() || child.isSymbolicLink() || skipped.has(child.name)) continue;
        if (depth >= limits.depth) { warnings.push(`Depth limit at ${directory}`); break; }
        if (queue.length + seen.size >= limits.directories) { warnings.push("Directory limit reached."); break; }
        queue.push({ directory: path.join(directory, child.name), depth: depth + 1 });
      }
    } catch (e) { warnings.push(`${directory}: ${String(e)}`); }
  }
  // A later discovered main checkout also corrects earlier linked-worktree labels.
  return { roots: provenance, repositories: repositories.map(r => ({ ...r, mainRoot: mainRoots.get(r.commonDir) })), warnings: [...new Set(warnings)], complete: warnings.length === 0 };
}
