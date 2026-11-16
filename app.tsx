import { useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  useBbContext,
  useRealtime,
} from "@get-bb/plugin-sdk/app";
import type {
  rpcContract,
  Snapshot,
  Operation,
  Read,
  Query,
  Commit,
  Repository,
  SetupCandidate,
} from "./contract";
import { layoutGraph, diffHunks } from "./graph";
import { PullRequests, type PrApi } from "./pull-requests";
import { SearchPicker } from "./picker";
import { branchOptions } from "./selection";
import { FileTree } from "./file-tree";
import { ChangesTree } from "./change-tree";
import {
  readPreference,
  savePreference,
  readSelection,
  restoreScope,
  resolveSavedRepository,
} from "./preferences";
import { Icon } from "./components/ui/icon";
import { gitButtonTone } from "./action-style";
import {CloneRepositoryDialog,type CloneApi,type CloneActivity} from './clone-dialog';
import { snapshot, catalogSchema, readResultSchema } from "./read-contract";
import { viewCache, cacheKey, workbenchViewSchema, syncTime, retainCatalog } from "./view-cache";
import "./style.css";
const emptyQuery: Query = {
  search: "",
  branch: "",
  author: "",
  path: "",
  since: "",
  limit: 200,
};
const baseOp: Operation = {
  action: "fetch",
  value: "",
  extra: "",
  paths: [],
  flag: false,
  mode: "mixed",
  patch: "",
  confirmed: false,
};
const destructive = [
  "discard",
  "branch-delete",
  "tag-delete",
  "stash-drop",
  "remote-remove",
  "worktree-remove",
  "reset",
];
const labels: Record<string, string> = {
  "checkout-remote": "Create tracking branch",
  "branch-create": "New branch",
  "branch-delete": "Delete branch",
  "branch-rename": "Rename current branch",
  "tag-create": "New tag",
  "tag-delete": "Delete tag",
  "stash-save": "Stash changes",
  "stash-apply": "Apply stash",
  "stash-pop": "Pop stash",
  "stash-drop": "Drop stash",
  "remote-add": "Add remote",
  "remote-remove": "Remove remote",
  "remote-url": "Change remote URL",
  "worktree-add": "New worktree",
  "worktree-remove": "Remove worktree",
  "worktree-prune": "Prune worktrees",
  "apply-patch": "Apply patch",
  "cherry-pick": "Cherry-pick",
  "merge-abort": "Abort merge",
  "rebase-abort": "Abort rebase",
  "rebase-continue": "Continue rebase",
  "cherry-pick-abort": "Abort cherry-pick",
  "cherry-pick-continue": "Continue cherry-pick",
};
const title = (s: string) => labels[s] || s[0]!.toUpperCase() + s.slice(1);
const colors = ["var(--foreground)", "var(--muted-foreground)", "var(--success, var(--foreground))", "var(--warning, var(--muted-foreground))"];
function Graph({ row }: { row: ReturnType<typeof layoutGraph>[number] }) {
  return (
    <svg
      width={Math.min(160, row.width * 16 + 16)}
      height="36"
      aria-label="Commit ancestry"
    >
      <g strokeWidth="1.8" fill="none">
        {row.edges.map((e, i) => (
          <path
            key={i}
            stroke={colors[e.color % colors.length]}
            d={`M ${e.from * 16 + 10} 0 L ${e.from * 16 + 10} 18 L ${e.to * 16 + 10} 36`}
          />
        ))}
      </g>
      <circle
        cx={row.lane * 16 + 10}
        cy="18"
        r="4"
        fill={colors[row.lane % colors.length]}
      />
    </svg>
  );
}

export function Workbench({ environment }: { environment?: { id: string } | null }) {
  const rpc = useRpc<typeof rpcContract>();
  const context = useBbContext();
  const [saved] = useState(readSelection);
  const cache = viewCache();
  const viewKey = cacheKey("workbench-view", environment?.id || "navigation");
  const [boot] = useState(() => {
    const catalog = cache.get(cacheKey("catalog"), catalogSchema)?.value;
    const view = cache.get(viewKey, workbenchViewSchema)?.value;
    const repository = resolveSavedRepository(catalog?.repositories || [], environment?.id || view?.repo || saved?.repo);
    const restored = repository && view?.repo === repository.id ? view : undefined;
    return {catalog, repository, view:restored};
  });
  const [restoring, setRestoring] = useState(true);
  const [treeView, setTreeView] = useState(() =>
    readPreference(
      "tree-view",
      true,
      (v): v is boolean => typeof v === "boolean",
    ),
  );
  const [repos, setRepos] = useState<Repository[]>(boot.catalog?.repositories || []);
  const [candidates, setCandidates] = useState<SetupCandidate[]>(boot.catalog?.setupCandidates || []);
  const [setup, setSetup] = useState<SetupCandidate | null>(null);
  const [warnings, setWarnings] = useState<string[]>(boot.catalog?[...boot.catalog.warnings,...(!boot.catalog.complete?["Repository discovery is incomplete."]:[])]:[]);
  const [repo, setRepo] = useState(boot.repository?.id || "");
  const [query, setQuery] = useState(boot.view?.query || emptyQuery);
  const [branchFilter, setBranchFilter] = useState("");
  const [tab, setTab] = useState<string>(boot.view?.tab || "Log");
  const [file, setFile] = useState(boot.view?.file || "");
  const [staged, setStaged] = useState(boot.view?.staged || false);
  const [selected, setSelected] = useState<string[]>([]);
  const [commit, setCommit] = useState<Commit | null>(boot.view?.commit || null);
  const [view, setView] = useState<"unified" | "split">(boot.view?.view || "unified");
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(boot.view?.ignoreWhitespace || false);
  const [commitPaths, setCommitPaths] = useState<string[]>([]);
  const [commitPath, setCommitPath] = useState(boot.view?.commitPath || "");
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cloneOpen,setCloneOpen]=useState(false),[cloneActivity,setCloneActivity]=useState<CloneActivity>('idle');
  const [loading, setLoading] = useState(false);
  const [preparingCheckout, setPreparingCheckout] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [checkoutRetry, setCheckoutRetry] = useState(0);
  const [dialog, setDialog] = useState<Operation | null>(null);
  const [consoleLines, setConsoleLines] = useState<string[]>([]);
  const [detail, setDetail] = useState<Read | null>(boot.view?.detail || null);
  const [projectId, setProjectId] = useState(boot.view?.projectId || saved?.projectId || "");
  const [worktreePath, setWorktreePath] = useState(boot.view?.worktreePath || "");
  const snapshotKey = cacheKey("snapshot", repo, worktreePath, query);
  const cachedSnapshot = cache.get(snapshotKey, snapshot);
  const [liveSnapshot, setLiveSnapshot] = useState<{key:string;value:Snapshot;updatedAt:number}|null>(null);
  const [catalogVerified, setCatalogVerified] = useState<string[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [freshSnapshot, setFreshSnapshot] = useState("");
  const data = liveSnapshot?.key === snapshotKey ? liveSnapshot.value : cachedSnapshot?.value || null;
  const canMutate = !!repo && catalogVerified.includes(repo) && freshSnapshot === snapshotKey;
  const mutationReady = useRef(canMutate); mutationReady.current = canMutate;
  const readRequest:Read|null = repo && (file || commit || detail) ? detail ?? {kind:commit?"commit":"diff",value:commit?.sha||"",path:commit?commitPath:file,staged,ignoreWhitespace} : null;
  const previewKey = cacheKey("read", repo, worktreePath, readRequest);
  const cachedPreview = readRequest ? cache.get(previewKey, readResultSchema) : undefined;
  const [preview, setPreview] = useState<{key:string;text:string;truncated:boolean}|null>(null);
  const [freshPreview, setFreshPreview] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const diff = !readRequest ? "" : preview?.key === previewKey ? preview.text : cachedPreview?.value.text || "";
  const truncated = !!readRequest && (preview?.key === previewKey ? preview.truncated : cachedPreview?.value.truncated || false);
  const target = {
    environmentId: repo,
    ...(worktreePath ? { worktreePath } : {}),
  };
  const prRpcRef = useRef(rpc);
  const refreshRef = useRef<()=>Promise<void>>(()=>Promise.resolve());
  prRpcRef.current = rpc;
  const cloneApi=useMemo<CloneApi>(()=>({options:()=>prRpcRef.current.call('cloneOptions',{}),start:input=>prRpcRef.current.call('cloneStart',input),status:id=>prRpcRef.current.call('cloneStatus',{id})}),[]);
  const prApi = useMemo<PrApi>(() => ({list: query => prRpcRef.current.call("prList", {...target, query}), read: read => prRpcRef.current.call("prRead", {...target, read}), mutate: op => {
    if (!mutationReady.current) return Promise.reject(Error("Wait for the repository refresh before applying an action."));
    mutationReady.current=false;generation.current++;readGeneration.current++;
    setFreshSnapshot("");
    cache.invalidate(key=>{try{const [kind,id]=JSON.parse(key);return ['snapshot','read'].includes(kind)&&id===repo;}catch{return false;}});
    return prRpcRef.current.call("prMutate", {...target, op}).finally(()=>{void refreshRef.current();});
  }}), [repo, worktreePath]);
  useEffect(() => {
    if (!data || !repo) return;
    if (restoring) {
      if (freshSnapshot !== snapshotKey) return;
      const selection = boot.view ? {...boot.view,branch:boot.view.query.branch} : saved;
      const scope = restoreScope(selection && {...selection, repo: repos.find(r => r.id === repo)?.legacyIds?.includes(selection.repo) ? repo : selection.repo}, projectId, repo, data);
      setWorktreePath(scope.worktreePath);
      setQuery((q) => ({ ...q, branch: scope.branch }));
      setRestoring(false);
      return;
    }
    savePreference("selection", {
      projectId,
      repo,
      worktreePath,
      branch: query.branch,
    });
  }, [data, repo, projectId, worktreePath, query.branch, restoring, saved, freshSnapshot, snapshotKey]);
  useEffect(() => {
    if (repo) cache.set(viewKey, {repo,projectId,worktreePath,query,tab,file,staged,commit,commitPath,detail,view,ignoreWhitespace});
  }, [viewKey,repo,projectId,worktreePath,query,tab,file,staged,commit,commitPath,detail,view,ignoreWhitespace]);
  useEffect(() => savePreference("tree-view", treeView), [treeView]);
  const generation = useRef(0);
  const readGeneration = useRef(0);
  const report = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  useEffect(() => {
    let live = true;
    setCatalogLoading(true);
    cache.load(cacheKey("catalog"), async () => {
      const previous=cache.get(cacheKey("catalog"),catalogSchema)?.value;
      const current=await rpc.call("catalog", {refresh: checkoutRetry > 0});
      return {...retainCatalog(current,previous),verifiedIds:current.repositories.map(r=>r.id)};
    }).then(c => {
      if (!live) return;
      setRepos(c.repositories); setCandidates(c.setupCandidates);
      setCatalogError("");
      setCatalogVerified(c.verifiedIds);
      setWarnings([...c.warnings, ...(!c.complete ? ["Repository discovery is incomplete."] : [])]);
      if (!repo && !setup) {
        const wanted = environment?.id || boot.view?.repo || saved?.repo;
        const found = resolveSavedRepository(c.repositories, wanted);
        if (found) { setRepo(found.id); setProjectId(saved?.projectId || found.projectIds?.[0] || ""); }
        else if (wanted) setCheckoutMessage("The remembered repository is unavailable. Refresh or choose a repository.");
      } else if (repo && c.complete && !c.repositories.some(r => r.id === repo)) {
        generation.current++; readGeneration.current++; setRepo("");
        setFreshSnapshot("");
        setCheckoutMessage("The selected repository is unavailable. Refresh or choose a repository.");
      }
    }, e => {if(live){setCatalogVerified([]);setCatalogError(e instanceof Error?e.message:String(e));}}).finally(()=>{if(live)setCatalogLoading(false);});
    return () => {live = false;};
  }, [rpc, checkoutRetry]);
  useEffect(() => {
    if (!setup) return;
    let live = true;
    const run = async () => {
      setPreparingCheckout(true);
      try {
        let job = await rpc.call("setupCheckout", {...setup, retry: true});
        while (live && job.status === "preparing") {
          setCheckoutMessage(job.message);
          await new Promise(resolve => setTimeout(resolve, 800));
          if (!live) return;
          job = await rpc.call("setupCheckout", {...setup, retry: false});
        }
        if (!live) return;
        if (job.status === "failed") throw Error(job.message);
        const c = await rpc.call("catalog", {projectId: setup.projectId, refresh: true});
        if (!live) return;
        const ids = job.repositories.map(r => r.id);
        const matches = c.repositories.filter(r => ids.includes(r.id) || r.legacyIds?.some(id => ids.includes(id)));
        setSetup(null); setCheckoutRetry(v => v + 1);
        if (matches.length === 1) {setRepo(matches[0]!.id); setProjectId(setup.projectId); setCheckoutMessage("");}
        else setCheckoutMessage("Checkout prepared. Choose its repository above.");
      } catch(e) {if (live) {report(e); setCheckoutMessage(String(e));}}
      finally {if (live) setPreparingCheckout(false);}
    };
    void run();
    return () => {live = false;};
  }, [rpc, setup]);
  const refresh = async () => {
    if (!repo) return;
    const id = ++generation.current;
    setLoading(true);
    try {
      const d = await cache.load(snapshotKey, () => rpc.call("snapshot", { ...target, query }));
      if (id === generation.current) {
        setLiveSnapshot({key:snapshotKey,value:d,updatedAt:Date.now()});
        setFreshSnapshot(snapshotKey);
        setError("");
        setSelected((s) => s.filter((p) => d.files.some((f) => f.path === p)));
      }
    } catch (e) {
      if (id === generation.current) {setFreshSnapshot("");report(e);}
    } finally {
      if (id === generation.current) setLoading(false);
    }
  };
  refreshRef.current = refresh;
  const lastTarget = useRef(cacheKey("target", repo, worktreePath));
  useEffect(() => {
    const key = cacheKey("target", repo, worktreePath);
    if (lastTarget.current === key) return;
    lastTarget.current = key;
    setLiveSnapshot(null); setFreshSnapshot("");
    setLoading(false);
    setFile("");
    setCommit(null);
    setDetail(null);
    setPreview(null);
    setSelected([]);
    setMessage("");
    setAmend(false);
    setDialog(null);
  }, [repo, worktreePath]);
  useEffect(() => {
    const t = setTimeout(() => void refresh(), 250);
    return () => {
      clearTimeout(t);
      generation.current++;
    };
  }, [repo, worktreePath, query, rpc]);
  useRealtime("changed", () => void refresh());
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden && !busy) void refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [repo, worktreePath, query, busy, rpc]);
  useEffect(() => {
    const resume = () => {if(!document.hidden){setCheckoutRetry(v=>v+1);void refresh();}};
    window.addEventListener("focus", resume); document.addEventListener("visibilitychange", resume);
    return () => {window.removeEventListener("focus", resume);document.removeEventListener("visibilitychange", resume);};
  }, [repo,worktreePath,query,rpc]);
  useEffect(() => {
    const id = ++readGeneration.current;
    if (!repo || (!file && !commit && !detail)) {
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);setFreshPreview("");
    cache.load(previewKey, () => rpc.call("read", { ...target, read: readRequest! })).then(
      (d) => {
        if (id === readGeneration.current) {
          setPreview({key:previewKey,text:d.text,truncated:d.truncated});
          setFreshPreview(previewKey);
        }
      },
      (e) => {
        if (id === readGeneration.current) report(e);
      },
    ).finally(()=>{if(id===readGeneration.current)setPreviewLoading(false);});
    return () => {
      readGeneration.current++;
    };
  }, [
    repo,
    worktreePath,
    file,
    staged,
    commit,
    commitPath,
    detail,
    ignoreWhitespace,
    data,
    rpc,
  ]);
  const previousCommit = useRef(commit?.sha);
  useEffect(() => {
    let live = true;
    if (previousCommit.current !== commit?.sha) setCommitPath("");
    previousCommit.current = commit?.sha;
    const request:Read = {
            kind: "commit-files",
            value: commit?.sha || "",
            path: "",
            staged: false,
            ignoreWhitespace: false,
    };
    const key=cacheKey("read",repo,worktreePath,request);
    const cached=commit?cache.get(key,readResultSchema):undefined;
    try{const paths:unknown=JSON.parse(cached?.value.text||"[]");setCommitPaths(Array.isArray(paths)&&paths.every(p=>typeof p==='string')?paths:[]);}catch{setCommitPaths([]);}
    if (commit)
      cache.load(key, () => rpc.call("read", {...target,read:request}))
        .then((r) => {
          if (live) {
            const paths: unknown = JSON.parse(r.text);
            if (
              Array.isArray(paths) &&
              paths.every((p) => typeof p === "string")
            )
              setCommitPaths(paths);
          }
        }, report);
    return () => {
      live = false;
    };
  }, [repo, worktreePath, commit, rpc]);
  async function execute(op: Operation) {
    if (busy) return;
    if (!canMutate || !mutationReady.current) {report(Error("Wait for the repository refresh before applying an action."));return;}
    mutationReady.current=false;generation.current++;readGeneration.current++;
    setBusy(true);
    setFreshSnapshot("");
    cache.invalidate(key=>{try{const [kind,id]=JSON.parse(key);return ['snapshot','read'].includes(kind)&&id===repo;}catch{return false;}});
    setError("");
    try {
      const r = await rpc.call("mutate", { ...target, op });
      setConsoleLines((old) => [
        ...old.slice(-49),
        `${new Date().toLocaleTimeString()}  ${title(op.action)}\n${r.text || "Completed."}${r.truncated ? "\n[Output truncated]" : ""}`,
      ]);
      if (op.action === "commit") {
        setMessage("");
        setAmend(false);
      }
      setDialog(null);
      await refresh();
    } catch (e) {
      setConsoleLines((old) => [
        ...old.slice(-49),
        `${title(op.action)} failed\n${e instanceof Error ? e.message : String(e)}`,
      ]);
      await refresh();
      report(e);
    } finally {
      setBusy(false);
    }
  }
  function action(
    action: Operation["action"],
    value = "",
    extra = "",
    paths: string[] = [],
  ) {
    setDialog({ ...baseOp, action, value, extra, paths });
  }
  function openClonedRepository(repository:Repository,createdProjectId:string){
    mutationReady.current=false;generation.current++;readGeneration.current++;
    cache.invalidate(key=>{try{return JSON.parse(key)[0]==='catalog';}catch{return false;}});
    setRepos(old=>[...old.filter(r=>r.id!==repository.id),repository]);
    setCatalogVerified(old=>[...old.filter(id=>id!==repository.id),repository.id]);
    setRestoring(false);setSetup(null);setRepo(repository.id);setProjectId(createdProjectId);setWorktreePath('');setQuery(emptyQuery);setTab('Log');
    setFreshSnapshot('');setError('');setCheckoutMessage('');setCheckoutRetry(v=>v+1);
  }
  function quick(action: Operation["action"], paths: string[] = []) {
    void execute({ ...baseOp, action, paths });
  }
  function pickFile(path: string, index: boolean) {
    setFile(path);
    setStaged(index);
    setCommit(null);
    setDetail(null);
    setTab("Log");
  }
  const graphs = layoutGraph(data?.commits ?? []);
  const hunks = diffHunks(diff);
  const btn = (
    label: string,
    onClick: () => void,
    icon?: string,
    disabled = false,
    readOnly = false,
  ) => (
    <button className={`gw-action-${gitButtonTone(label)}`} disabled={disabled || busy || !repo || (!readOnly && !canMutate)} onClick={onClick}>
      {icon && <Icon name={icon} className="gw-icon" />}
      {label}
    </button>
  );
  function renderChange(
    f: Snapshot["files"][number],
    index: boolean,
    displayName: string,
  ) {
    return (
      <div
        key={f.path}
        className={`gw-file ${file === f.path && staged === index ? "selected" : ""}`}
      >
        <input
          type="checkbox"
          checked={selected.includes(f.path)}
          aria-label={`Select ${f.path}`}
          onChange={(e) =>
            setSelected((old) =>
              e.target.checked
                ? [...old, f.path]
                : old.filter((p) => p !== f.path),
            )
          }
        />
        <button
          className="gw-file-name"
          title={f.original ? `${f.original} → ${f.path}` : f.path}
          onClick={() => pickFile(f.path, index)}
        >
          <span className={f.conflict ? "gw-danger" : "gw-status"}>
            {f.conflict ? "!" : index ? f.index : f.worktree}
          </span>
          {displayName}
        </button>
        <button
          aria-label={`${index ? "Unstage" : "Stage"} ${f.path}`}
          onClick={() => quick(index ? "unstage" : "stage", [f.path])}
        >
          {index ? "−" : "+"}
        </button>
      </div>
    );
  }
  function changes(index: boolean) {
    const files =
      data?.files.filter((f) =>
        index
          ? f.index !== " " && f.index !== "?"
          : f.worktree !== " " || f.index === "?",
      ) ?? [];
    const filesByPath = new Map(files.map((f) => [f.path, f]));
    return (
      <section className="gw-file-group">
        <div className="gw-section">
          <span>
            {index ? "Staged" : "Changes"} <small>{files.length}</small>
          </span>
          {btn(
            index ? "Unstage all" : "Stage all",
            () =>
              quick(
                index ? "unstage" : "stage",
                files.map((f) => f.path),
              ),
            undefined,
            !files.length,
          )}
        </div>
        {files.length === 0 ? (
          <p className="gw-empty">
            {index ? "No staged files" : "Working tree is clean"}
          </p>
        ) : treeView ? (
          <ChangesTree
            paths={files.map((f) => f.path)}
            renderFile={(path, label) =>
              renderChange(filesByPath.get(path)!, index, label)
            }
          />
        ) : (
          files.map((f) => renderChange(f, index, f.path))
        )}
      </section>
    );
  }
  const valueLabel = dialog?.action.startsWith("worktree-")
    ? "Absolute worktree path"
    : dialog?.action.startsWith("remote-")
      ? "Remote name"
      : dialog?.action.startsWith("stash-")
        ? "Stash reference or message"
        : dialog?.action === "commit"
          ? "Commit message"
          : dialog?.action === "push"
            ? "Remote (blank uses configured upstream)"
            : "Branch, tag, or commit";
  return (
    <div className="gw" data-bb-plugin="git-workbench" data-bb-plugin-root="">
      <header className="gw-header">
        <div className="gw-brand">
          <Icon name="GitBranch" className="gw-icon" />
          <strong>Git Workbench</strong>
          <span className="gw-pill">{data?.branch || "Repository"}</span>
        </div>
        <SearchPicker
          label="Repository"
          placeholder="Choose repository…"
          value={repo || setup?.id || ""}
          disabled={busy}
          action={{
            label:cloneActivity==='working'?'Cloning…':cloneActivity==='ready'?'Open cloned repository…':cloneActivity==='attention'?'Clone progress…':'Clone repository…',
            icon:<Icon name="Download" className="gw-icon"/>,
            disabled:busy||preparingCheckout,
            onSelect:()=>setCloneOpen(true),
          }}
          options={[
            ...repos.map(r => ({id:r.id, label:r.name, detail:`${r.path} · ${r.hostName || r.hostId}${!catalogLoading&&!catalogVerified.includes(r.id)?" · Last seen":""}`, group:`${r.projectNames?.join(", ") || "Repositories"} · ${r.hostName || r.hostId}`})),
            ...candidates.map(c => ({id:c.id, label:`${c.name} · Prepare checkout`, detail:`${c.path || "Clone configured remote"} · ${c.hostName}`, group:`${c.projectName} · ${c.hostName}`}))
          ]}
          onChange={(id) => {
            if (id === repo) return;
            generation.current++; readGeneration.current++;
            setRestoring(false); setRepo(""); setWorktreePath(""); setQuery(emptyQuery);
            setBranchFilter(""); setConsoleLines([]); setLiveSnapshot(null); setFreshSnapshot(""); setDialog(null); setFile(""); setCommit(null); setDetail(null); setPreview(null); setSelected([]); setCommitPaths([]); setCommitPath(""); setError(""); setCheckoutMessage("");
            const candidate = candidates.find(c => c.id === id);
            setSetup(candidate || null);
            if (!candidate) {const r = repos.find(r => r.id === id); if (r) {setRepo(r.id); setProjectId(r.projectIds?.[0] || "");}}
          }}
        />
        <SearchPicker
          label="Branch or worktree"
          visibilityKey="branch-groups"
          placeholder={loading ? "Loading…" : "Choose branch or worktree…"}
          disabled={!repo || busy || !data}
          value={
            query.branch
              ? `ref:${query.branch}`
              : data
                ? `worktree:${data.root}`
                : ""
          }
          options={data ? branchOptions(data) : []}
          onChange={(id) => {
            if (id.startsWith("worktree:")) {
              setWorktreePath(id.slice(9));
              setQuery({ ...query, branch: "" });
            } else {
              setQuery({ ...query, branch: id === "all" ? "" : id.slice(4) });
              setTab("Log");
            }
          }}
        />
        {btn("Checkout…", () => action("checkout", data?.refs.find(r => r.kind === "heads" && r.current)?.name || ""), "GitBranch", !data)}
        <div className="gw-spacer" />
        {btn(
          loading ? "Refreshing…" : "Refresh",
          () => {setCheckoutRetry(v => v + 1); void refresh();},
          "RefreshCw",
          false,
          true,
        )}
        {btn("Fetch", () => quick("fetch"), "Download")}
        {btn("Pull", () => action("pull"), "ArrowDown")}
        {btn("Push", () => action("push"), "ArrowUp")}
      </header>
      {data && (!canMutate || loading || !!diff && freshPreview!==previewKey) && <div className="gw-sync-status" role="status"><span>{loading || catalogLoading || previewLoading ? "Refreshing in background…" : "Showing saved view · Refresh to reconnect"}</span><small>Last loaded {syncTime(!!diff&&freshPreview!==previewKey?cachedPreview?.updatedAt||Date.now():liveSnapshot?.key===snapshotKey?liveSnapshot.updatedAt:cachedSnapshot?.updatedAt||Date.now())}</small></div>}
      {warnings.length > 0 && <details className="gw-catalog-warnings"><summary role="status">Repository discovery incomplete · {warnings.length} notices</summary><div>{warnings.map((w,i) => <p key={i}>{w}</p>)}</div></details>}
      {(error || catalogError) && (
        <div className="gw-error" role="alert">
          {error || catalogError}
          <button onClick={() => {setError("");setCatalogError("");}} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
      {!repo ? (
        <div
          className="gw-empty gw-checkout-setup"
          role="status"
          aria-live="polite"
        >
          <strong>{preparingCheckout ? "Preparing repository checkout…" : catalogLoading ? "Loading repositories…" : "Choose a repository"}</strong>
          <p>{checkoutMessage || "Select a repository above. Missing checkouts can be prepared by selecting their setup action."}</p>
          <button disabled={preparingCheckout} onClick={() => {if (setup) setSetup({...setup}); else setCheckoutRetry(v => v + 1);}}>Refresh / retry</button>
        </div>
      ) : (
        <div className={`gw-layout${tab === "Pull requests" ? " gw-layout-pr" : ""}`}>
          {tab !== "Pull requests" && <aside className="gw-changes">
            <div className="gw-pane-title">
              <span>Commit</span>
              <button
                className="gw-view-toggle"
                aria-label="Directory tree view"
                aria-pressed={treeView}
                title={
                  treeView
                    ? "Switch to flat list"
                    : "Group changes by directory"
                }
                onClick={() => setTreeView((v) => !v)}
              >
                <Icon name={treeView ? "Folder" : "List"} className="gw-icon" />
                {treeView ? "Tree" : "List"}
              </button>
              <span className="gw-muted">
                {data?.files.length ?? "…"} files
              </span>
            </div>
            <div className="gw-change-scroll">
              {changes(false)}
              {changes(true)}
            </div>
            <div className="gw-selection">
              {btn(
                "Stage",
                () => quick("stage", selected),
                undefined,
                !selected.length,
              )}
              {btn(
                "Unstage",
                () => quick("unstage", selected),
                undefined,
                !selected.length,
              )}
              {btn(
                "Discard…",
                () => action("discard", "", "", selected),
                undefined,
                !selected.length,
              )}
            </div>
            <div className="gw-compose">
              <label className="gw-check">
                <input
                  type="checkbox"
                  checked={amend}
                  onChange={(e) => setAmend(e.target.checked)}
                />
                Amend last commit
              </label>
              <textarea
                aria-label="Commit message"
                placeholder="Commit message…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <div className="gw-toolbar">
                <button
                  className="gw-primary"
                  disabled={busy || !message.trim() || !canMutate}
                  onClick={() =>
                    amend
                      ? action("commit", message)
                      : void execute({
                          ...baseOp,
                          action: "commit",
                          value: message,
                        })
                  }
                >
                  Commit{amend ? " (amend)" : ""}
                </button>
                {btn("Stash…", () => action("stash-save"))}
              </div>
            </div>
          </aside>}
          <main className={`gw-main${tab === "Pull requests" ? " gw-main-pr" : ""}`}>
            <nav className="gw-tabs">
              {["Pull requests", "Log", "Worktrees", "Stash", "Remotes", "Console"].map((t) => (
                <button
                  key={t}
                  className={tab === t ? "active" : ""}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
              <div className="gw-spacer" />
              <details className="gw-menu">
                <summary>Git operations ▾</summary>
                <div>
                  {(
                    [
                      "branch-create",
                      "branch-rename",
                      "tag-create",
                      "merge",
                      "rebase",
                      "cherry-pick",
                      "revert",
                      "reset",
                      "apply-patch",
                      "merge-abort",
                      "rebase-abort",
                      "rebase-continue",
                      "cherry-pick-abort",
                      "cherry-pick-continue",
                    ] as const
                  ).map((a) => (
                    <button
                      key={a}
                      className={`gw-action-${gitButtonTone(title(a))}`}
                      onClick={(e) => {
                        e.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                        action(a, commit?.sha || "");
                      }}
                    >
                      {title(a)}…
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setDetail({
                        kind: "reflog",
                        value: "",
                        path: "",
                        staged: false,
                        ignoreWhitespace: false,
                      });
                      setCommit(null);
                      setTab("Log");
                    }}
                  >
                    Reflog
                  </button>
                </div>
              </details>
            </nav>
            {tab === "Pull requests" ? (<PullRequests key={cacheKey("target",repo,worktreePath)} api={prApi} scope={repo + worktreePath} cacheScope={cacheKey("target",repo,worktreePath)} enabled={canMutate}/>) : tab === "Log" ? (
              <>
                <div className="gw-filters">
                  <input
                    placeholder="Text or hash…"
                    aria-label="Search commits"
                    value={query.search}
                    onChange={(e) =>
                      setQuery({ ...query, search: e.target.value })
                    }
                  />
                  <input
                    placeholder="Author…"
                    aria-label="Author filter"
                    value={query.author}
                    onChange={(e) =>
                      setQuery({ ...query, author: e.target.value })
                    }
                  />
                  <input
                    placeholder="Path…"
                    aria-label="Path filter"
                    value={query.path}
                    onChange={(e) =>
                      setQuery({ ...query, path: e.target.value })
                    }
                  />
                  <input
                    type="date"
                    aria-label="Commits since"
                    value={query.since}
                    onChange={(e) =>
                      setQuery({ ...query, since: e.target.value })
                    }
                  />
                  <select
                    aria-label="History limit"
                    value={query.limit}
                    onChange={(e) =>
                      setQuery({ ...query, limit: Number(e.target.value) })
                    }
                  >
                    {[100, 200, 500, 1000, 2000].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div className="gw-log-layout">
                  <aside className="gw-branches">
                    <input
                      placeholder="Branch or tag…"
                      aria-label="Filter refs"
                      value={branchFilter}
                      onChange={(e) => setBranchFilter(e.target.value)}
                    />
                    <button
                      className={!query.branch ? "selected" : ""}
                      onClick={() => setQuery({ ...query, branch: "" })}
                    >
                      All branches
                    </button>
                    <button
                      onClick={() => setQuery({ ...query, branch: "HEAD" })}
                    >
                      HEAD (current branch)
                    </button>
                    {["heads", "remotes", "tags"].map((kind) => (
                      <details open key={kind}>
                        <summary>
                          {kind === "heads"
                            ? "Local"
                            : kind === "remotes"
                              ? "Remote"
                              : "Tags"}
                        </summary>
                        {data?.refs
                          .filter(
                            (r) =>
                              r.kind === kind &&
                              r.name
                                .toLowerCase()
                                .includes(branchFilter.toLowerCase()),
                          )
                          .map((r) => (
                            <div className="gw-ref" key={r.kind + r.name}>
                              <button
                                className={
                                  query.branch ===
                                  (kind === "heads"
                                    ? "refs/heads/"
                                    : kind === "tags"
                                      ? "refs/tags/"
                                      : "refs/remotes/") +
                                    r.name
                                    ? "selected"
                                    : ""
                                }
                                onClick={() =>
                                  setQuery({
                                    ...query,
                                    branch:
                                      (kind === "heads"
                                        ? "refs/heads/"
                                        : kind === "tags"
                                          ? "refs/tags/"
                                          : "refs/remotes/") + r.name,
                                  })
                                }
                                title={r.upstream}
                              >
                                {r.current ? "●" : "⑂"} {r.name}
                              </button>
                              <details>
                                <summary aria-label={`Actions for ${r.name}`}>
                                  ⋮
                                </summary>
                                <div className="gw-ref-actions">
                                  {kind === "heads" ? (
                                    <>
                                      {btn("Checkout", () =>
                                        action("checkout", r.name),
                                      )}
                                      {btn("Merge into current", () =>
                                        action("merge", r.name),
                                      )}
                                      {btn("Rebase current onto", () =>
                                        action("rebase", r.name),
                                      )}
                                      {btn("Delete", () =>
                                        action("branch-delete", r.name),
                                      )}
                                    </>
                                  ) : kind === "tags" ? (
                                    btn("Delete tag", () =>
                                      action("tag-delete", r.name),
                                    )
                                  ) : (
                                    btn("Track branch", () =>
                                      action(
                                        "checkout-remote",
                                        r.name,
                                      ),
                                    )
                                  )}
                                </div>
                              </details>
                            </div>
                          ))}
                      </details>
                    ))}
                    {btn("New branch…", () => action("branch-create"), "Plus")}
                  </aside>
                  <div className="gw-history">
                    <div className="gw-log-head">
                      <span>Graph / Subject</span>
                      <span>Author</span>
                      <span>Date</span>
                    </div>
                    <div className="gw-commits">
                      {data?.commits.map((c, i) => (
                        <button
                          key={c.sha}
                          className={`gw-commit ${commit?.sha === c.sha ? "selected" : ""}`}
                          onClick={() => {
                            setCommit(c);
                            setFile("");
                            setDetail(null);
                          }}
                        >
                          <span className="gw-commit-subject">
                            <Graph row={graphs[i]!} />
                            <span>
                              {c.subject}
                              {c.refs && (
                                <small className="gw-ref-label">{c.refs}</small>
                              )}
                            </span>
                          </span>
                          <span className="gw-author">{c.author}</span>
                          <time>{new Date(c.date).toLocaleDateString()}</time>
                        </button>
                      ))}
                      {data && !data.commits.length && (
                        <div className="gw-empty">
                          No commits match these filters.
                        </div>
                      )}
                      {data && data.commits.length >= query.limit && (
                        <div className="gw-empty">
                          Showing the first {query.limit} commits. Raise the
                          limit or narrow the filters.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <section className="gw-diff">
                  <div className="gw-toolbar">
                    <strong title={commit?.sha}>
                      {detail
                        ? title(detail.kind)
                        : commit
                          ? `${commit.sha.slice(0, 8)} · ${commit.subject}`
                          : file
                            ? `${staged ? "Staged" : "Working tree"} · ${file}`
                            : "Changes preview"}
                    </strong>
                    <div className="gw-spacer" />
                    {file && (
                      <>
                        {btn("History", () =>
                          setDetail({
                            kind: "history",
                            path: file,
                            value: "",
                            staged: false,
                            ignoreWhitespace: false,
                          }),
                        )}
                        {btn("Blame", () =>
                          setDetail({
                            kind: "blame",
                            path: file,
                            value: "",
                            staged: false,
                            ignoreWhitespace: false,
                          }),
                        )}
                      </>
                    )}
                    {commit && (
                      <>
                        {btn("Cherry-pick…", () =>
                          action("cherry-pick", commit.sha),
                        )}
                        {btn("Revert…", () => action("revert", commit.sha))}
                      </>
                    )}
                    <label className="gw-check">
                      <input
                        type="checkbox"
                        checked={ignoreWhitespace}
                        onChange={(e) => setIgnoreWhitespace(e.target.checked)}
                      />
                      Ignore whitespace
                    </label>
                    <button
                      onClick={() =>
                        setView(view === "unified" ? "split" : "unified")
                      }
                    >
                      {view === "unified" ? "Split view" : "Unified view"}
                    </button>
                    <button
                      disabled={!diff}
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(
                          new Blob([diff], { type: "text/plain" }),
                        );
                        a.download = "changes.patch";
                        a.click();
                        URL.revokeObjectURL(a.href);
                      }}
                    >
                      Export
                    </button>
                  </div>
                  {data?.files.find((f) => f.path === file)?.conflict && (
                    <div className="gw-conflict">
                      Resolve conflict:
                      {btn("Use ours…", () => action("ours", "", "", [file]))}
                      {btn("Use theirs…", () =>
                        action("theirs", "", "", [file]),
                      )}
                      {btn("Mark resolved", () => quick("stage", [file]))}
                      <span>Review the resulting diff before staging.</span>
                    </div>
                  )}
                  {truncated && (
                    <div className="gw-error">
                      Preview truncated at 500,000 characters. Narrow the
                      selection before exporting or applying a patch.
                    </div>
                  )}
                  <div className="gw-review-body">
                    {commit && commitPaths.length > 0 && (
                      <aside className="gw-commit-files">
                        <button
                          className={!commitPath ? "selected" : ""}
                          onClick={() => setCommitPath("")}
                        >
                          All changed files ({commitPaths.length})
                        </button>
                        <FileTree
                          paths={commitPaths}
                          selected={commitPath}
                          onSelect={setCommitPath}
                        />
                      </aside>
                    )}
                    <div
                      className={`gw-code ${view === "split" ? "gw-split" : ""}`}
                    >
                      {!diff ? (
                        <div className="gw-empty">
                          {file
                            ? "No textual diff. This may be a binary file or a mode-only change."
                            : "Select a commit or file to review changes."}
                        </div>
                      ) : (
                        diff.split("\n").map((line, i) => (
                          <div
                            key={i}
                            className={`gw-line ${line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : line.startsWith("@@") ? "hunk" : ""}`}
                          >
                            <span className="gw-line-number">{i + 1}</span>
                            {view === "split" ? (
                              <>
                                <pre>{line.startsWith("+") ? "" : line}</pre>
                                <pre>{line.startsWith("-") ? "" : line}</pre>
                              </>
                            ) : (
                              <pre>{line}</pre>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  {file &&
                    !staged &&
                    !detail &&
                    !ignoreWhitespace &&
                    !truncated &&
                    hunks.length > 0 && (
                      <div className="gw-hunks">
                        {hunks.map((h, i) =>
                          btn(`Stage hunk ${i + 1}`, () => {
                            setDialog({
                              ...baseOp,
                              action: "apply-patch",
                              patch: h,
                              flag: true,
                            });
                          }, undefined, freshPreview!==previewKey),
                        )}
                      </div>
                    )}
                </section>
              </>
            ) : tab === "Worktrees" ? (
              <div className="gw-page">
                <div className="gw-toolbar">
                  {btn("New worktree…", () => action("worktree-add"), "Plus")}
                  {btn("Prune stale metadata", () => action("worktree-prune"))}
                </div>
                {data?.worktrees
                  .trim()
                  .split("\n\n")
                  .map((block, i) => {
                    const lines = block.split("\n"),
                      p =
                        lines
                          .find((l) => l.startsWith("worktree "))
                          ?.slice(9) || "",
                      branch =
                        lines.find((l) => l.startsWith("branch "))?.slice(7) ||
                        "Detached";
                    return (
                      <div className="gw-worktree" key={i}>
                        <Icon name="FolderGit2" className="gw-icon" />
                        <div>
                          <strong>{p.split("/").pop()}</strong>
                          <p>{branch.replace("refs/heads/", "")}</p>
                          <small>{p}</small>
                        </div>
                        {p === data.root ? (
                          <span className="gw-pill">Current</span>
                        ) : (
                          btn("Remove…", () => action("worktree-remove", p))
                        )}
                      </div>
                    );
                  })}
              </div>
            ) : tab === "Stash" ? (
              <div className="gw-page">
                {btn("Stash changes…", () => action("stash-save"), "Plus")}
                {data?.stashes.map((s) => (
                  <div className="gw-worktree" key={s.ref}>
                    <div>
                      <strong>{s.ref}</strong>
                      <p>{s.subject}</p>
                    </div>
                    {btn("Show", () => {
                      setDetail({
                        kind: "stash",
                        value: s.ref,
                        path: "",
                        staged: false,
                        ignoreWhitespace: false,
                      });
                      setTab("Log");
                      setCommit(null);
                    })}
                    {btn("Apply…", () => action("stash-apply", s.ref))}
                    {btn("Pop…", () => action("stash-pop", s.ref))}
                    {btn("Drop…", () => action("stash-drop", s.ref))}
                  </div>
                ))}
                {!data?.stashes.length && (
                  <p className="gw-empty">No stashes saved.</p>
                )}
              </div>
            ) : tab === "Remotes" ? (
              <div className="gw-page">
                <div className="gw-toolbar">
                  {btn("Add remote…", () => action("remote-add"), "Plus")}
                  {btn("Change URL…", () => action("remote-url"))}
                  {btn("Remove remote…", () => action("remote-remove"))}
                </div>
                <pre>{data?.remotes || "No remotes configured."}</pre>
              </div>
            ) : (
              <div className="gw-page gw-console">
                <button onClick={() => setConsoleLines([])}>
                  Clear console
                </button>
                {consoleLines.length ? (
                  consoleLines.map((l, i) => <pre key={i}>{l}</pre>)
                ) : (
                  <p className="gw-empty">Git operation output appears here.</p>
                )}
              </div>
            )}
            <footer className="gw-footer">
              <span>{data?.root || "Loading repository…"}</span>
              <div className="gw-spacer" />
              {data?.upstream && (
                <span>
                  ↑ {data.ahead} ↓ {data.behind} · {data.upstream}
                </span>
              )}
              <span>
                {busy ? "Running Git…" : loading || catalogLoading ? "Refreshing…" : canMutate ? "Ready" : "Saved view"}
              </span>
            </footer>
          </main>
        </div>
      )}
      <CloneRepositoryDialog api={cloneApi} open={cloneOpen} onClose={()=>setCloneOpen(false)} onOpen={openClonedRepository} onActivityChange={setCloneActivity} preferredHostId={repos.find(r=>r.id===repo)?.hostId} canOpen={!busy&&!dialog&&!message.trim()} disabled={busy||preparingCheckout}/>
      {dialog && (
        <div
          className="gw-overlay"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) setDialog(null);
          }}
        >
          <form
            className="gw-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={title(dialog.action)}
            onSubmit={(e) => {
              e.preventDefault();
              void execute({
                ...dialog,
                flag: dialog.action === "commit" ? true : dialog.flag,
              });
            }}
          >
            <div className="gw-pane-title">
              {title(dialog.action)}
              <button
                type="button"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                ×
              </button>
            </div>
            <p className="gw-muted">
              {data?.branch} · {data?.root}
            </p>
            {["checkout", "checkout-remote"].includes(dialog.action) && <>
              <p>Checked out: <strong>{data?.branch}</strong>. The branch picker browses history only. Checkout changes files in this worktree.</p>
              <label>Branch to check out
                <select required autoFocus value={`${dialog.action === "checkout" ? "heads" : "remotes"}:${dialog.value}`} onChange={e => {
                  const [kind, ...name] = e.target.value.split(":");
                  setDialog({...dialog, action: kind === "heads" ? "checkout" : "checkout-remote", value:name.join(":"), extra:""});
                }}>
                  <option value="">Choose a branch…</option>
                  {data?.refs.filter(r => ["heads","remotes"].includes(r.kind) && !r.name.endsWith("/HEAD")).map(r => <option key={`${r.kind}:${r.name}`} value={`${r.kind}:${r.name}`}>{r.kind === "heads" ? "Local" : "Remote"} · {r.name}</option>)}
                </select>
              </label>
              {dialog.action === "checkout-remote" && <label>New local tracking branch name<input value={dialog.extra} required onChange={e => setDialog({...dialog, extra:e.target.value})}/></label>}
              <p className="gw-muted">Local and ignored files remain protected. Remote checkout creates a new tracking branch; an existing name is refused.</p>
            </>}
            {![
              "checkout", "checkout-remote",
              "stage",
              "unstage",
              "discard",
              "fetch",
              "pull",
              "ours",
              "theirs",
              "worktree-prune",
              "merge-abort",
              "rebase-abort",
              "rebase-continue",
              "cherry-pick-abort",
              "cherry-pick-continue",
              "apply-patch",
            ].includes(dialog.action) && (
              <label>
                {valueLabel}
                <input
                  autoFocus
                  value={dialog.value}
                  onChange={(e) =>
                    setDialog({ ...dialog, value: e.target.value })
                  }
                />
              </label>
            )}
            {[
              "branch-create",
              "remote-add",
              "remote-url",
              "worktree-add",
              "push",
              "tag-create",
            ].includes(dialog.action) && (
              <label>
                {dialog.action.startsWith("remote")
                  ? "Remote URL"
                  : dialog.action === "worktree-add"
                    ? "Branch name"
                    : dialog.action === "tag-create"
                      ? "Annotation (optional)"
                      : dialog.action === "push"
                        ? "Branch (optional)"
                        : "Start point (optional)"}
                <input
                  value={dialog.extra}
                  onChange={(e) =>
                    setDialog({ ...dialog, extra: e.target.value })
                  }
                />
              </label>
            )}
            {["push", "pull", "worktree-add", "apply-patch"].includes(
              dialog.action,
            ) && (
              <label className="gw-check">
                <input
                  type="checkbox"
                  checked={dialog.flag}
                  onChange={(e) =>
                    setDialog({ ...dialog, flag: e.target.checked })
                  }
                />
                {dialog.action === "push"
                  ? "Force with lease (rewrites remote history)"
                  : dialog.action === "pull"
                    ? "Rebase instead of fast-forward only"
                    : dialog.action === "worktree-add"
                      ? "Create a new branch"
                      : "Apply to staging area"}
              </label>
            )}
            {dialog.action === "reset" && (
              <label>
                Reset mode
                <select
                  value={dialog.mode}
                  onChange={(e) =>
                    setDialog({
                      ...dialog,
                      mode: e.target.value as Operation["mode"],
                    })
                  }
                >
                  {["soft", "mixed", "hard"].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                <small>Hard reset discards tracked file changes.</small>
              </label>
            )}
            {dialog.action === "apply-patch" && (
              <label>
                Unified patch
                <textarea
                  rows={12}
                  value={dialog.patch}
                  onChange={(e) =>
                    setDialog({ ...dialog, patch: e.target.value })
                  }
                />
              </label>
            )}
            {dialog.paths.length > 0 && <pre>{dialog.paths.join("\n")}</pre>}
            {["ours", "theirs"].includes(dialog.action) && (
              <p>
                Replace the working file with the selected side. During a
                rebase, “ours” is the branch being rebased onto. Review the file
                and then mark it resolved.
              </p>
            )}
            {destructive.includes(dialog.action) && (
              <label className="gw-check gw-danger">
                <input
                  type="checkbox"
                  checked={dialog.confirmed}
                  onChange={(e) =>
                    setDialog({ ...dialog, confirmed: e.target.checked })
                  }
                />
                I understand this changes or removes repository data.
              </label>
            )}
            {error && (
              <p role="alert" className="gw-danger">
                {error}
              </p>
            )}
            <div className="gw-toolbar gw-dialog-actions">
              <div className="gw-spacer" />
              <button
                className="gw-secondary"
                type="button"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>
              <button
                className={`gw-primary${destructive.includes(dialog.action)?" gw-destructive":""}`}
                type="submit"
                disabled={
                  busy || !canMutate ||
                  (destructive.includes(dialog.action) && !dialog.confirmed)
                }
              >
                {busy ? "Running…" : title(dialog.action)}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "workbench",
    title: "Git Workbench",
    icon: "GitBranch",
    path: "workbench",
    component: () => <Workbench />,
  });
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "fixed",
    id: "git-workbench",
    title: "Git Workbench",
    icon: "GitBranch",
    component: Workbench,
    layout: "flush",
  });
});
