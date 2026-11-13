import type { Snapshot } from "./contract";
export type ChoiceOption = {
  id: string;
  label: string;
  detail: string;
  group: string;
};
export function filterOptions(options: ChoiceOption[], search: string) {
  const terms = search.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return options.filter((o) =>
    terms.every((t) =>
      `${o.label} ${o.detail} ${o.group}`.toLocaleLowerCase().includes(t),
    ),
  );
}
export function worktrees(raw: string) {
  return raw
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      return {
        path: lines.find((l) => l.startsWith("worktree "))?.slice(9) || "",
        branch:
          lines
            .find((l) => l.startsWith("branch "))
            ?.slice(7)
            .replace(/^refs\/heads\//, "") || "Detached HEAD",
        unavailable: lines.some((l) => l.startsWith("prunable")),
      };
    })
    .filter((w) => w.path && !w.unavailable);
}
export function branchOptions(data: Snapshot): ChoiceOption[] {
  return [
    ...worktrees(data.worktrees).map((w) => ({
      id: `worktree:${w.path}`,
      label: w.branch,
      detail: w.path,
      group: "Worktrees",
    })),
    ...data.refs
      .filter((r) => r.kind === "heads" || r.kind === "remotes")
      .map((r) => ({
        id: `ref:refs/${r.kind === "heads" ? "heads" : "remotes"}/${r.name}`,
        label: r.name,
        detail: r.current
          ? "Checked out in this worktree"
          : r.upstream || "Browse branch history",
        group: r.kind === "heads" ? "Local branches" : "Remote branches",
      })),
  ];
}
