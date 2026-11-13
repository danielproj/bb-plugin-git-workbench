import { useMemo, useState, type ReactNode } from "react";
export type DirectoryNode = {
  name: string;
  path: string;
  count: number;
  directories: DirectoryNode[];
  files: string[];
};
export function directoryTree(paths: string[]): DirectoryNode {
  const root: DirectoryNode = {
    name: "",
    path: "",
    count: 0,
    directories: [],
    files: [],
  };
  for (const path of paths) {
    let node = root;
    node.count++;
    const parts = path.split("/");
    for (const name of parts.slice(0, -1)) {
      let child = node.directories.find((d) => d.name === name);
      if (!child) {
        child = {
          name,
          path: node.path ? node.path + "/" + name : name,
          count: 0,
          directories: [],
          files: [],
        };
        node.directories.push(child);
      }
      node = child;
      node.count++;
    }
    node.files.push(path);
  }
  const sort = (node: DirectoryNode) => {
    node.directories.sort((a, b) => a.name.localeCompare(b.name));
    node.files.sort((a, b) => a.localeCompare(b));
    node.directories.forEach(sort);
  };
  sort(root);
  return root;
}
export function ChangesTree({
  paths,
  renderFile,
}: {
  paths: string[];
  renderFile: (path: string, label: string) => ReactNode;
}) {
  const root = useMemo(() => directoryTree(paths), [paths]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  function render(node: DirectoryNode): ReactNode {
    return (
      <ul className="gw-changes-tree">
        {node.directories.map((dir) => (
          <li key={"dir:" + dir.path}>
            <button
              className="gw-directory"
              aria-expanded={!collapsed.has(dir.path)}
              title={dir.path}
              onClick={() =>
                setCollapsed((old) => {
                  const next = new Set(old);
                  if (next.has(dir.path)) next.delete(dir.path);
                  else next.add(dir.path);
                  return next;
                })
              }
            >
              <span aria-hidden="true">
                {collapsed.has(dir.path) ? "▸" : "▾"}
              </span>
              <span className="gw-folder-icon" aria-hidden="true" />
              <span className="gw-directory-name">{dir.name}</span>
              <small>{dir.count}</small>
            </button>
            {!collapsed.has(dir.path) && render(dir)}
          </li>
        ))}
        {node.files.map((path) => (
          <li key={"file:" + path}>
            {renderFile(path, path.slice(path.lastIndexOf("/") + 1))}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div>
      <div className="gw-tree-tools">
        <button
          onClick={() => {
            const all: string[] = [];
            const walk = (n: DirectoryNode) =>
              n.directories.forEach((d) => {
                all.push(d.path);
                walk(d);
              });
            walk(root);
            setCollapsed(new Set(all));
          }}
        >
          Collapse all
        </button>
        <button onClick={() => setCollapsed(new Set())}>Expand all</button>
      </div>
      {render(root)}
    </div>
  );
}
