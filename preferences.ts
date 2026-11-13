import type { Snapshot } from "./contract";
import { worktrees } from "./selection";
const prefix = "bb.git-workbench.";
export function readPreference<T>(
  key: string,
  fallback: T,
  valid: (v: unknown) => v is T,
): T {
  try {
    const raw = globalThis.localStorage?.getItem(prefix + key);
    if (raw) {
      const v: unknown = JSON.parse(raw);
      if (valid(v)) return v;
    }
  } catch {}
  return fallback;
}
export function savePreference(key: string, value: unknown) {
  try {
    globalThis.localStorage?.setItem(prefix + key, JSON.stringify(value));
  } catch {
    /* Preferences must not block Git when storage is unavailable. */
  }
}
export const stringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
export type SavedSelection = {
  projectId: string;
  repo: string;
  worktreePath: string;
  branch: string;
};
export function readSelection() {
  return readPreference<SavedSelection | null>(
    "selection",
    null,
    (v): v is SavedSelection | null =>
      v === null ||
      (typeof v === "object" &&
        ["projectId", "repo", "worktreePath", "branch"].every(
          (k) => typeof (v as Record<string, unknown>)[k] === "string",
        )),
  );
}
export function restoreScope(
  saved: SavedSelection | null,
  projectId: string,
  repo: string,
  data: Snapshot,
) {
  if (!saved || saved.projectId !== projectId || saved.repo !== repo)
    return { worktreePath: "", branch: "" };
  return {
    worktreePath: worktrees(data.worktrees).some(
      (w) => w.path === saved.worktreePath,
    )
      ? saved.worktreePath
      : "",
    branch:
      saved.branch === "HEAD" ||
      data.refs.some(
        (r) =>
          `refs/${r.kind === "heads" ? "heads" : r.kind === "remotes" ? "remotes" : "tags"}/${r.name}` ===
          saved.branch,
      )
        ? saved.branch
        : "",
  };
}
