import { ChangesTree } from "./change-tree";
import type { ReactNode } from "react";
/** Shared compact commit/PR tree. File keys and callbacks always use full paths. */
export function FileTree({paths, selected, onSelect, viewed, suffix}: {
  paths: string[]; selected: string; onSelect: (path: string) => void;
  viewed?: (path: string) => boolean;
  suffix?: (path: string) => ReactNode;
}) {
  return <div className="gw-file-tree"><ChangesTree paths={paths} renderFile={(path,label) =>
    <button type="button" className="gw-tree-file" title={path} aria-pressed={selected === path} onClick={() => onSelect(path)}>
      <span aria-hidden="true">{viewed?.(path) ? "✓" : "↳"}</span><span className="gw-tree-label">{label}</span>{suffix&&<span className="gw-tree-extra">{suffix(path)}</span>}
    </button>
  }/></div>;
}
