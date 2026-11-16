---
name: git-workbench
description: Inspect or operate Git repositories through the Git Workbench BB plugin's validated RPC, or help use its visual client.
---

Open Git Workbench from BB's navigation rail or a thread's fixed Git Workbench tab. Select a repository using its project/machine/path context, then filter its branches or worktrees by typing. Branch selection browses history; worktree selection changes the active checkout. The plugin runs Git on the checkout's machine. Selecting a named Prepare checkout action prepares that specific missing checkout on its specified machine without creating an agent thread. Catalog discovery is read-only.

Inspect exact schemas with `bb plugin rpc inspect git-workbench`. Use `bb plugin rpc call git-workbench <method> --input-file <file> --json` for catalog, projects, repositories, setupCheckout, snapshot, read, or mutate. Always inspect the contract first. Write JSON input to a unique file under thread storage. Do not supply undefined values; omit optional keys.

Read calls are bounded. Preserve and report any truncation flag. Never interpret a capped history as the complete repository. Mutations change the real repository and require authorization appropriate to the user's request. Destructive operations require `confirmed: true`; do not set it without the user's instruction authorizing that specific action. Merely inspecting Git does not authorize committing, pushing, deleting, or resetting.

The plugin does not offer complete JetBrains parity. Interactive rebase, three-way merge editing, clone/init, non-GitHub hosting and submodule/LFS management are outside its current scope. Refer to the plugin README for current limits.


## GitHub Merge control

Pull requests supports GitHub PR search, creation from published branches, metadata, inline review drafts, discussions, current-head CI and bounded failed logs, guarded merge and auto-merge. Authenticate `gh` on the selected repository host. Credentials stay there. Creation never pushes. Checkout/worktree actions require confirmation; checkout protects dirty and ignored local files.

Inspect `prList`, `prRead`, `prMutate` schemas before calling. Mutations require explicit confirmation and expected head (creation excepted). Read-only inspection does not authorize writes. Drafts persist locally by head; uncertain failures retain drafts. Refresh and reconcile before retrying. GitHub rules apply; no administrator bypass.

Threads and metadata candidates cover bounded first pages; incomplete coverage prevents readiness. A matching-head null rollup plus empty REST check/status arrays means no CI, while unavailable or inconsistent coverage is unknown. Binary/large patches cannot accept inline drafts. Split view shows patch columns, not full source. Merge queues depend on GitHub auto-merge; separate queue enrollment is unavailable.

Verification: local Git and fake mutation tests, live read-only GitHub schemas, build and installed reload. No live PR writes tested. Component screenshot QA does not establish authenticated installed full-page/thread-pane QA, which remains unverified. Detailed evidence is under artifacts/git-workbench-merge-control.


## Pull request inbox

Opening Pull requests shows a detailed, keyboard-accessible inbox. Rows show GitHub title/number, state, author initials, source → base, a plain-text description preview, up to ten labels, update date, and reported CI/review summaries. Choose a row to open Merge control; **Back to pull requests** preserves the search, state and page. Search is debounced by 300 ms. Changing a query hides old results until its response arrives. Open includes drafts; Closed excludes merged PRs; Merged and All have separate filters. Lists sort by recently updated, with at most 50 results per page. The page count is not an archive total.

Inbox health uses one bounded GraphQL batch for the page, without fetching each PR's full checks or details. It is a reported aggregate, not merge readiness. Missing/failed hydration or a mismatched head shows unavailable health and keeps the PR selectable. A null rollup says “no checks reported”; it does not mean success. Review “not reported” does not mean approved. Selecting a PR loads authoritative detail and existing conservative merge guards. Labels and previews are intentionally capped; full content remains in detail/GitHub. GitHub search indexing and updates between list/detail reads can affect freshness.

Use catalog for repository-first navigation and visible partial-discovery warnings. Persist opaque repository IDs; migrate only exact legacyIds. Never choose a sibling when a saved repository disappears. Branch/worktree scope belongs only to the selected repository. Setup candidates are explicit actions bound to projectId/sourceId/hostId, never Git targets.

The toolbar **Checkout…** action changes the selected verified worktree; branch-picker browsing remains read-only. Local checkout requires an actual local branch. Remote checkout explicitly creates a new named local tracking branch and refuses collisions. Git switch/branch-create paths protect ignored files with `--no-overwrite-ignore`; never recommend force/reset/auto-stash to bypass checkout errors. Missing registered checkout candidates remain explicit clone/restore selections. The visual material is macOS-inspired CSS, not native AppKit integration.


Workbench displays the last cached view immediately and revalidates in the background. Cached data is scoped to repository, worktree and query and is held in bounded browser-session storage; failures keep it visible with an explicit status. Treat it as display state, never authorization or current merge readiness. Navigation and page reloads restore the last tab, PR, filters and selected file. First visits and evicted/oversized records fetch normally. Checks/status/workflow cards use external links like the PR link; supplied provider, timing and workflow metadata stays optional. All actual Git/PR mutations still require fresh validation and the existing confirmation rules.


## New repository checkout

The toolbar **Clone repository…** accepts an HTTPS/SSH Git remote, a selected persistent machine, project name and new absolute destination. It checks out the default branch, registers a local-path BB project source, and opens the resulting verified repository. No agent thread is created. Existing destinations, symlinks and Git metadata paths are refused; credentials stay with Git on the selected host. Closing the dialog leaves the clone running without switching the current repository. Reopen its toolbar progress entry to finish opening it.

RPCs: `cloneOptions` is read-only; `cloneStart` requires `confirmed: true`, a UUID request ID, exact host/URL/path/name binding and optional explicit `retry`; `cloneStatus` polls that ID. Never replay a creation blindly with a new ID after a timeout. Retry the same failed job for registration recovery; a completed clone's identity and origin are checked before reuse. Status can be lost after plugin reload; refresh the catalog before attempting another clone. This does not authorize cloning an unspecified real repository during agent QA.
