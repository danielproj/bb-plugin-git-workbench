import type { Commit } from "./contract";
export function layoutGraph(commits: Commit[]) {
  let lanes: string[] = [];
  return commits.map((c) => {
    let lane = lanes.indexOf(c.sha);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push(c.sha);
    }
    const before = [...lanes];
    const next = lanes.filter((x) => x !== c.sha);
    for (let j = 0; j < c.parents.length; j++) {
      const p = c.parents[j]!;
      if (!next.includes(p)) next.splice(Math.min(lane + j, next.length), 0, p);
    }
    const edges = before.flatMap((s, i) =>
      s === c.sha
        ? c.parents.map((p) => ({ from: i, to: next.indexOf(p), color: lane }))
        : next.includes(s)
          ? [{ from: i, to: next.indexOf(s), color: i }]
          : [],
    );
    lanes = next;
    return { lane, width: Math.max(before.length, next.length, 1), edges };
  });
}
export function diffHunks(text: string) {
  const lines = text.split("\n");
  const first = lines.findIndex((l) => l.startsWith("@@ "));
  if (first < 0) return [];
  const header = lines.slice(0, first).join("\n") + "\n";
  const starts = lines.flatMap((l, i) => (l.startsWith("@@ ") ? [i] : []));
  return starts.map(
    (s, i) =>
      header +
      lines
        .slice(s, starts[i + 1] ?? lines.length)
        .join("\n")
        .replace(/\n*$/, "\n"),
  );
}
