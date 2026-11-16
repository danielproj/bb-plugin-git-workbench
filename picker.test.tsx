import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";

import { SearchPicker } from "./picker";
import { branchOptions, filterOptions } from "./selection";
import type { Snapshot } from "./contract";
test("typing filters labels, paths and groups without confusing same-named local and remote branches", () => {
  const opts = branchOptions({
    worktrees:
      "worktree /repo\nbranch refs/heads/main\n\nworktree /repo-feature\nbranch refs/heads/feature\n",
    refs: [
      { name: "main", kind: "heads", current: true, upstream: "origin/main" },
      { name: "origin/main", kind: "remotes", current: false, upstream: "" },
    ],
  } as Snapshot);
  assert.equal(
    filterOptions(opts, "remote main")[0]?.id,
    "ref:refs/remotes/origin/main",
  );
  assert.equal(
    filterOptions(opts, "repo-feature")[0]?.id,
    "worktree:/repo-feature",
  );
  assert.equal(filterOptions(opts, "local main")[0]?.id, "ref:refs/heads/main");
  assert.equal(filterOptions(opts, "nonexistent").length, 0);
});
test("picker supports typing, keyboard selection, no matches and Escape", async () => {
  const dom = new JSDOM('<div id="app"></div>', { url: "http://localhost" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const container = document.getElementById("app")!;
  const root = createRoot(container);
  let chosen = "";
  try {
    await act(async () =>
      root.render(
        <SearchPicker
          label="Project"
          placeholder="Choose project"
          value=""
          options={[
            { id: "a", label: "Alpha", detail: "", group: "Projects" },
            { id: "b", label: "Beta", detail: "", group: "Projects" },
          ]}
          onChange={(v) => {
            chosen = v;
          }}
        />,
      ),
    );
    await act(async () => container.querySelector("button")!.click());
    const input = container.querySelector("input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "beta");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    assert.equal(container.querySelectorAll("[role=option]").length, 1);
    assert.match(
      container.querySelector("[role=option]")!.textContent!,
      /Beta/,
    );
    // Keyboard navigation operates on filtered results; use native value events through React's DOM adapter.
    await act(async () =>
      input.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "End", bubbles: true }),
      ),
    );
    await act(async () =>
      input.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
        }),
      ),
    );
    await act(async () =>
      input.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
        }),
      ),
    );
    assert.equal(chosen, "b");
    assert.equal(container.querySelector('[role="listbox"]'), null);
    await act(async () => container.querySelector("button")!.click());
    await act(async () =>
      container.querySelector("input")!.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      ),
    );
    assert.equal(container.querySelector('[role="listbox"]'), null);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test("group visibility survives remount and does not hide the selected trigger label", async () => {
  const dom = new JSDOM('<div id="app"></div>', { url: "http://localhost" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const container = document.getElementById("app")!;
  const root = createRoot(container);
  const options = [
    { id: "local", label: "main", detail: "/repo", group: "Local branches" },
    {
      id: "remote",
      label: "origin/main",
      detail: "",
      group: "Remote branches",
    },
  ];
  const view = (key: string) => (
    <SearchPicker
      key={key}
      label="Branch"
      placeholder="Choose"
      visibilityKey="test-groups"
      value="remote"
      options={options}
      onChange={() => {}}
    />
  );
  try {
    await act(async () => root.render(view("one")));
    await act(async () => container.querySelector("button")!.click());
    const hide = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".gw-group-toggles button",
      ),
    ].find((b) => b.textContent?.includes("Remote"))!;
    await act(async () => hide.click());
    assert.equal(container.querySelectorAll("[role=option]").length, 1);
    assert.match(
      container.querySelector(".gw-picker-trigger")!.textContent!,
      /origin\/main/,
    );
    await act(async () => root.render(view("two")));
    await act(async () => container.querySelector("button")!.click());
    assert.equal(container.querySelectorAll("[role=option]").length, 1);
    assert.equal(
      [...container.querySelectorAll(".gw-group-toggles button")]
        .find((b) => b.textContent?.includes("Remote"))!
        .getAttribute("aria-pressed"),
      "false",
    );
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test("directory tree groups duplicate basenames, collapses folders and preserves full file paths", async () => {
  const { ChangesTree, directoryTree } = await import("./change-tree");
  const paths = ["src/b/index.ts", "src/a/index.ts", "README.md"];
  const tree = directoryTree(paths);
  assert.equal(tree.count, 3);
  assert.equal(tree.directories[0]?.count, 2);
  const dom = new JSDOM('<div id="app"></div>', { url: "http://localhost" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import("react-dom/client");
  const container = document.getElementById("app")!;
  const root = createRoot(container);
  let picked = "";
  try {
    await act(async () =>
      root.render(
        <ChangesTree
          paths={paths}
          renderFile={(path, label) => (
            <button
              data-path={path}
              onClick={() => {
                picked = path;
              }}
            >
              {label}
            </button>
          )}
        />,
      ),
    );
    assert.equal(container.querySelectorAll("[data-path]").length, 3);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-path="src/b/index.ts"]')!
        .click(),
    );
    assert.equal(picked, "src/b/index.ts");
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((b) => b.textContent === "Collapse all")!
        .click(),
    );
    assert.equal(container.querySelectorAll("[data-path]").length, 1);
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((b) => b.textContent === "Expand all")!
        .click(),
    );
    assert.equal(container.querySelectorAll("[data-path]").length, 3);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test("selection preferences validate storage and restore only existing scopes", async () => {
  const { savePreference, readSelection, restoreScope } =
    await import("./preferences");
  const dom = new JSDOM("", { url: "http://localhost" });
  Object.assign(globalThis, { localStorage: dom.window.localStorage });
  try {
    const saved = {
      projectId: "p",
      repo: "r",
      worktreePath: "/linked",
      branch: "refs/remotes/origin/main",
    };
    savePreference("selection", saved);
    assert.deepEqual(readSelection(), saved);
    const data = {
      worktrees: "worktree /linked\nbranch refs/heads/feature\n",
      refs: [{ kind: "remotes", name: "origin/main" }],
    } as Snapshot;
    assert.deepEqual(restoreScope(saved, "p", "r", data), {
      worktreePath: "/linked",
      branch: saved.branch,
    });
    assert.deepEqual(restoreScope(saved, "p", "missing", data), {
      worktreePath: "",
      branch: "",
    });
    assert.deepEqual(
      restoreScope(saved, "p", "r", { ...data, refs: [], worktrees: "" }),
      { worktreePath: "", branch: "" },
    );
    localStorage.setItem("bb.git-workbench.selection", "{bad json");
    assert.equal(readSelection(), null);
  } finally {
    dom.window.close();
  }
});

test("shared commit/PR tree preserves duplicate basename identity, viewed marks and collapse controls", async () => {
  const dom = new JSDOM('<div id="shared"></div>');
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  const {createRoot}=await import('react-dom/client');
  const {FileTree}=await import('./file-tree');
  const root=createRoot(document.getElementById('shared')!);
  let picked='';
  try {
    await act(async()=>root.render(<FileTree paths={['a/index.ts','b/index.ts']} selected="b/index.ts" viewed={p=>p==='a/index.ts'} onSelect={p=>{picked=p}}/>));
    assert.equal(document.querySelectorAll('.gw-tree-file').length,2);
    assert.equal(document.querySelector('[title="b/index.ts"]')?.getAttribute('aria-pressed'),'true');
    assert.match(document.querySelector('[title="a/index.ts"]')!.textContent!,/✓/);
    await act(async()=> (document.querySelector('[title="b/index.ts"]') as HTMLButtonElement).click());
    assert.equal(picked,'b/index.ts');
    await act(async()=> [...document.querySelectorAll('button')].find(b=>b.textContent==='Collapse all')!.click());
    assert.equal(document.querySelectorAll('.gw-tree-file').length,0);
    await act(async()=> [...document.querySelectorAll('button')].find(b=>b.textContent==='Expand all')!.click());
    assert.equal(document.querySelectorAll('.gw-tree-file').length,2);
  } finally {await act(async()=>root.unmount());dom.window.close();}
});

test('repository preference migration never selects an ambiguous child or sibling', async()=>{
 const {resolveSavedRepository,restoreScope}=await import('./preferences');
 const rows=[{id:'repo:a',name:'same',path:'/a',hostId:'one',legacyIds:['source:a']},{id:'repo:b',name:'same',path:'/b',hostId:'two',legacyIds:['source:b']}];
 assert.equal(resolveSavedRepository(rows,'source:b')?.id,'repo:b');
 assert.equal(resolveSavedRepository(rows,'repo:a')?.path,'/a');
 assert.equal(resolveSavedRepository(rows,'container'),undefined);
 assert.equal(resolveSavedRepository(rows.slice(1),'repo:a'),undefined);
 assert.equal(resolveSavedRepository(rows.map(r=>({...r,legacyIds:['ambiguous']})),'ambiguous'),undefined);
 const data={worktrees:'worktree /b\nbranch refs/heads/main\n',refs:[{name:'main',kind:'heads'}]} as Snapshot;
 const saved={projectId:'p',repo:'repo:a',worktreePath:'/a',branch:'refs/heads/main'};
 assert.deepEqual(restoreScope(saved,'p','repo:b',data),{worktreePath:'',branch:''});
 assert.deepEqual(restoreScope({...saved,repo:'repo:b',worktreePath:'/b'},'p','repo:b',data),{worktreePath:'/b',branch:'refs/heads/main'});
});
