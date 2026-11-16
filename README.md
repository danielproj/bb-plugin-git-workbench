# Git Workbench for BB

A JetBrains-inspired Git client that runs inside BB. Installed as `git-workbench`, it adds a **Git Workbench** navigation page and a fixed tab on threads. Choose an actual Git root with the searchable **Repository** picker. Results include project, machine and full path context; sibling and nested repositories are separate choices, while linked worktrees share an entry. The **Branch or worktree** picker contains only that repository's worktrees and branches. Search matches name, path and context. Selection is saved on this browser/device; unambiguous old IDs migrate, and a missing remembered repository requires reselection. Choosing a branch browses history without checking it out. Discovery warnings remain visible when results are partial.

## Install

Install [BB](https://getbb.app) and make its `bb` command available in your terminal, then run:

```sh
bb plugin install https://github.com/danielproj/bb-plugin-git-workbench
```

Confirm the installation prompt. BB downloads the source, installs the runtime dependencies, and builds the plugin automatically; no separate clone or manual build is needed.

Open **Git Workbench** in BB's navigation sidebar or a thread's Git Workbench tab. Choose a repository, then a branch or worktree. Selecting a named **Prepare checkout** action restores that source on its specified machine and reports progress/retry. Browsing the catalog does not clone anything. Git must be installed on each repository's machine; network operations use that machine's existing SSH keys or Git credential helper.

Requires BB >=0.49 with Plugin SDK >=0.6.132. BB plugins run with full trust on the server and the selected repository host. Review the source before confirming installation.

To update an installation made from GitHub:

```sh
bb plugin update git-workbench
```

## Available features

- Clone a new HTTPS/SSH repository on a chosen machine, register it as a BB project, and open its default branch; background progress, collision protection and registration retries.
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

## Clone a new repository

Open the **Repository** dropdown and choose **Clone repository…** at the bottom. Enter an HTTPS URL or SSH remote, choose an online machine, and review the project name and absolute destination folder. **Clone and open** checks out the remote's default branch, registers that checkout as a new BB project, and opens it in Workbench. The destination must not exist; existing folders, symlinks and repositories are never replaced. Git uses the selected machine's configured credentials. URLs containing passwords, HTTP user info, tokens in query parameters, or unsupported transports are refused.

You can close the dialog while the clone runs. The action at the bottom of the **Repository** dropdown changes to **Cloning…**, **Open cloned repository…** or **Clone progress…** and returns to its status. Closing the dialog keeps your current repository open; a completed background clone waits until you reopen it. The clone job is remembered within the browser session and does not create an agent thread. If registration fails after cloning, **Retry registration** verifies and reuses the same checkout. Files are preserved on failure. An interrupted plugin reload can lose progress tracking; refresh the repository picker to see whether registration completed before starting another request.

After opening the new repository, use the separate **Checkout…** action to switch branches or create a local tracking branch.

## Scope and limits

This release implements the operations listed above. It is not complete JetBrains feature parity. It does not yet include interactive rebase/reordering/squashing, a three-way merge editor, arbitrary line selection, changelists/shelf, GitLab and other hosting providers, initializing an empty repository, submodule/LFS management, or dedicated signing/authentication UI. Use the existing Git CLI or hosting plugins for those features.

Repositories are discovered beneath registered sources and relevant ready environments on connected machines. Repository names come from Git's main checkout, so linked-worktree folder names never replace the repository label. The main checkout is preferred when discovered; otherwise operations stay on a discovered, registered worktree. Only explicitly selected setup actions prepare missing checkouts; source and machine remain bound through polling. Offline machines and bounded discovery produce warnings. Git worktrees appear in the second picker even without their own BB environment; each selected path is checked against the repository’s actual worktree list. Registering it as a BB environment is only needed for other BB features. Worktree removal uses Git's safe refusal for dirty worktrees; no forced removal or filesystem deletion is offered. Untracked discard is deliberately refused by Git restore.

History is capped by the chosen limit. File history is capped at 100 commits and reflog at 200 entries. Text previews cap at 500,000 characters with a visible truncation notice; truncated exports are incomplete. Binary files have no textual preview. Ordinary Git commands have a 60-second limit and a 4 MiB raw output ceiling. Restoring a missing checkout allows five minutes; setup status is polled independently so navigating away does not start duplicate clones. Larger repositories may require narrower filters. The graph draws the returned commit window, not the entire repository.

Network operations use noninteractive Git credentials on the repository host. Configure SSH keys or a credential helper there. Git hooks and signing configuration remain active; a hook or signing program requiring interactive input can fail or time out. No credentials are stored by this plugin.

## Architecture

`contract.ts` defines validated frontend/server and server/host RPC schemas. `server.ts` resolves environment or project-source IDs to machine and path; browser input cannot supply a different host or repository root. `host.ts` dispatches to `git.ts` and serializes writes by the repository's common Git directory, including linked worktrees. This queue covers this plugin's operations; Git locks protect against other clients.

Git executes through an argument array without a shell. Revision operands reject option-like input. File operands use literal pathspecs and reject absolute paths and parent traversal. Destructive actions require explicit confirmation in both the frontend and backend. Reads and writes carry the request cancellation signal to their subprocess. There is no arbitrary shell command RPC.

## Development

Requires BB >=0.49, SDK >=0.6.132, Node 22+, and Git. Run `npm install`, `npm run typecheck`, `npm test`, and `bb plugin build`. Install with `bb plugin install . --yes`; rebuild and `bb plugin reload git-workbench` after changes, or use `bb plugin dev`.

The integration suite uses disposable repositories and a local bare remote. It exercises actual Git operations, conflicts, hunk staging, file lists, filters, ancestry, and the SDK host contract. It never mutates a user's working repository. Repository setup tests cover source discovery without environments, clone deduplication, offline machines, failed authentication, and preservation of existing directories.

The plugin exposes typed `catalog`, `projects`, `repositories`, `setupCheckout`, `snapshot`, `read` and `mutate` RPC methods. `repositories` is a read; `setupCheckout` starts or polls automatic setup, with explicit retry after a failure. Inspect schemas with `bb plugin rpc inspect git-workbench`. Calls use `bb plugin rpc call git-workbench <method> --input-file <json-file> --json`. There is no custom CLI command or agent tool.


## GitHub Merge control

Pull requests supports GitHub PR search, creation from published branches, metadata, inline review drafts, discussions, current-head CI and bounded failed logs, guarded merge and auto-merge. Authenticate `gh` on the selected repository host. Credentials stay there. Creation never pushes. Checkout/worktree actions require confirmation; checkout protects dirty and ignored local files.

The Split studio review page keeps the shared file tree on the left, code and review sections in the center, and readiness plus people and labels on the right. The description is collapsed by default and uses BB's Markdown renderer when expanded. Green, violet, amber and red distinguish success, review, attention and failure; incomplete, stale or unreported data stays explicit. Narrow panels stack the columns, with all existing review and confirmation actions available.

Workbench restores the last tab, query, PR, file and diff before refreshing in the background. Successful read responses are cached per repository/worktree and query in this browser tab's session storage (up to 2 MB and 48 entries), with a memory fallback if storage is unavailable. The cache survives navigation and page reloads within that browser session. Cold visits and evicted or oversized records still fetch normally. Pending reads finish after navigation without starting continuous background polling. Failed refreshes keep the last available view and disclose the failure. Writes invalidate affected read caches; cached permissions and check results cannot establish merge readiness. Refreshes also run on return/focus, with visible Git state polled every 15 seconds and PR data every 60 seconds.

Checks use grouped status cards with required/optional classification, provider, workflow, duration and timestamps when GitHub supplies them. Invalid or unfinished durations stay absent. Workflow cards show the run number, trigger, branch and attempt. Check/status/workflow links open externally using the same new-window link pattern as Open on GitHub. Output uses the host Markdown renderer behind an expandable summary. Missing classifications, incomplete coverage, and bounded workflow lists stay explicit.

Toolbar buttons, text fields, selects, navigation controls and dialog actions share a 34 px desktop height (44 px for coarse pointers); compact file-tree rows retain their own shared row height. Green marks primary actions, violet branch/network/review actions, amber caution, and red destructive actions. Confirmation sheets identify the exact action and strategy, keep Cancel distinct, and retain existing confirmation and current-head guards.


Inspect `prList`, `prRead`, `prMutate` schemas before calling. Mutations require explicit confirmation and expected head (creation excepted). Read-only inspection does not authorize writes. Drafts persist locally by head; uncertain failures retain drafts. Refresh and reconcile before retrying. GitHub rules apply; no administrator bypass.

Threads and metadata candidates cover bounded first pages; incomplete coverage prevents readiness. A matching-head null rollup plus empty REST check/status arrays means no CI, while unavailable or inconsistent coverage is unknown. Binary/large patches cannot accept inline drafts. Split view shows patch columns, not full source. Merge queues depend on GitHub auto-merge; separate queue enrollment is unavailable.

Verification: local Git and fake mutation tests, live read-only GitHub schemas, build and installed reload. No live PR writes tested. Component screenshot QA does not establish authenticated installed full-page/thread-pane QA, which remains unverified. Detailed evidence is under artifacts/git-workbench-merge-control.


## Pull request inbox

Opening Pull requests shows a detailed, keyboard-accessible inbox. Rows show GitHub title/number, state, author initials, source → base, a plain-text description preview, up to ten labels, update date, and reported CI/review summaries. Choose a row to open Merge control; **Back to pull requests** preserves the search, state and page. Search is debounced by 300 ms. Changing a query hides old results until its response arrives. Open includes drafts; Closed excludes merged PRs; Merged and All have separate filters. Lists sort by recently updated, with at most 50 results per page. The page count is not an archive total.

Inbox health uses one bounded GraphQL batch for the page, without fetching each PR's full checks or details. It is a reported aggregate, not merge readiness. Missing/failed hydration or a mismatched head shows unavailable health and keeps the PR selectable. A null rollup says “no checks reported”; it does not mean success. Review “not reported” does not mean approved. Selecting a PR loads authoritative detail and existing conservative merge guards. Labels and previews are intentionally capped; full content remains in detail/GitHub. GitHub search indexing and updates between list/detail reads can affect freshness.

Use **Checkout…** in the main toolbar to change the selected repository's verified worktree. The branch picker only browses history. Select a local branch, or a remote branch and an explicit **new local tracking branch name**. Existing names, other worktrees, conflicting changes and ignored-file collisions are protected; there is no automatic stash, reset or force. The checked-out branch refreshes after success. Missing registered checkout entries still clone/restore their configured source only when explicitly selected.

The interface uses a neutral, macOS-inspired web glass treatment on navigation and controls, with opaque content and sheets. This is CSS, not native AppKit material. It follows [Apple materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials) and [Liquid Glass adoption guidance](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass). Reduced transparency, contrast, forced colors, reduced motion and unsupported-backdrop fallbacks preserve readability without changing system settings.
