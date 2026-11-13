# Git Workbench for BB

A JetBrains-inspired Git client that runs inside BB. Installed as `git-workbench`, it adds a **Git Workbench** navigation page and a fixed tab on threads. Choose a project with the searchable **Project** picker, then type in **Branch or worktree** to filter its worktrees, local branches, or remote branches. Arrow keys and Enter select a result; Escape dismisses the picker. Toggle the group chips to hide Worktrees, Local branches, Remote branches, or Other checkouts. The latest project, checkout, branch, view mode, and hidden groups are saved in this browser/device. Saved branches and worktrees are checked against the current repository when restoring; removed selections fall back to an available checkout. Choosing a branch browses its history without switching the working branch. Choosing a worktree changes the checkout used for status, commits and other operations. Other registered project checkouts are grouped separately, including checkouts on different machines. Git runs on that environment's enrolled machine, using its existing Git credentials and configuration.

## Install

Install [BB](https://getbb.app) and make its `bb` command available in your terminal, then run:

```sh
bb plugin install https://github.com/danielproj/bb-plugin-git-workbench
```

Confirm the installation prompt. BB downloads the source, installs the runtime dependencies, and builds the plugin automatically; no separate clone or manual build is needed.

Open **Git Workbench** in BB's navigation sidebar or a thread's Git Workbench tab. Choose a project, then a branch or worktree. The project needs a ready Git checkout registered in BB. Git must be installed on each repository's machine; network operations use that machine's existing SSH keys or Git credential helper.

Requires BB >=0.49 with Plugin SDK >=0.6.132. BB plugins run with full trust on the server and the selected repository host. Review the source before confirming installation.

To update an installation made from GitHub:

```sh
bb plugin update git-workbench
```

## Available features

- Working changes and staged files with a persistent Tree/List toggle, collapsible directories, and Collapse all/Expand all controls; file selection, stage/unstage per file or in bulk, tracked-file discard, commit and amend.
- Unified and split textual diffs, whitespace toggle, patch export/import, and staging individual hunks in tracked files.
- Topological commit graph, local/remote/tag references, subject or hash search, author/path/date filters, history limits up to 2,000 commits.
- Commit details and a directory tree of changed files; file history, blame, and reflog.
- Branch creation, switch, tracking a remote branch, rename, safe deletion; lightweight and annotated tags.
- Fetch/prune, fast-forward pull or pull with rebase, push/upstream setup and force with lease.
- Merge, rebase, cherry-pick, revert, soft/mixed/hard reset; abort and continue controls.
- Conflict detection, choose ours/theirs, review then mark resolved. During a rebase, ours means the branch being rebased onto.
- Stash including untracked files, inspect/apply/pop/drop.
- Add/change/remove remotes; list/add/remove/prune Git worktrees.
- Operation console and automatic refresh every 15 seconds, plus manual refresh and refresh after mutations.

## Scope and limits

This release implements the operations listed above. It is not complete JetBrains feature parity. It does not yet include interactive rebase/reordering/squashing, a three-way merge editor, arbitrary line selection, changelists/shelf, GitHub/GitLab pull request or CI integration, clone/init, submodule/LFS management, or dedicated signing/authentication UI. Use the existing Git CLI or hosting plugins for those features.

Projects use ready environments that BB identifies as Git repositories. Create or register a checkout through BB first. Git worktrees appear in the second picker even without their own BB environment; each selected path is checked against the repository’s actual worktree list. Registering it as a BB environment is only needed for other BB features. Worktree removal uses Git's safe refusal for dirty worktrees; no forced removal or filesystem deletion is offered. Untracked discard is deliberately refused by Git restore.

History is capped by the chosen limit. File history is capped at 100 commits and reflog at 200 entries. Text previews cap at 500,000 characters with a visible truncation notice; truncated exports are incomplete. Binary files have no textual preview. Commands have a 60-second limit and a 4 MiB raw output ceiling. Larger repositories may require narrower filters. The graph draws the returned commit window, not the entire repository.

Network operations use noninteractive Git credentials on the repository host. Configure SSH keys or a credential helper there. Git hooks and signing configuration remain active; a hook or signing program requiring interactive input can fail or time out. No credentials are stored by this plugin.

## Architecture

`contract.ts` defines validated frontend/server and server/host RPC schemas. `server.ts` resolves environment IDs to machine and path; browser input cannot supply a different host or repository root. `host.ts` dispatches to `git.ts` and serializes writes by the repository's common Git directory, including linked worktrees. This queue covers this plugin's operations; Git locks protect against other clients.

Git executes through an argument array without a shell. Revision operands reject option-like input. File operands use literal pathspecs and reject absolute paths and parent traversal. Destructive actions require explicit confirmation in both the frontend and backend. Reads and writes carry the request cancellation signal to their subprocess. There is no arbitrary shell command RPC.

## Development

Requires BB >=0.49, SDK >=0.6.132, Node 22+, and Git. Run `npm install`, `npm run typecheck`, `npm test`, and `bb plugin build`. Install with `bb plugin install . --yes`; rebuild and `bb plugin reload git-workbench` after changes, or use `bb plugin dev`.

The integration suite uses disposable repositories and a local bare remote. It exercises actual Git operations, conflicts, hunk staging, file lists, filters, ancestry, and the SDK host contract. It never mutates a user's working repository.

The plugin exposes typed `projects`, `repositories`, `snapshot`, `read` and `mutate` RPC methods. Inspect schemas with `bb plugin rpc inspect git-workbench`. Calls use `bb plugin rpc call git-workbench <method> --input-file <json-file> --json`. There is no custom CLI command or agent tool.
