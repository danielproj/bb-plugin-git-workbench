# Git Workbench

JetBrains-inspired Git navigation page and thread tab. Backend Git processes run on the selected environment's enrolled host. See README.md for implemented features, known parity gaps, validation, and operational limits.


## GitHub Merge control

Pull requests supports GitHub PR search, creation from published branches, metadata, inline review drafts, discussions, current-head CI and bounded failed logs, guarded merge and auto-merge. Authenticate `gh` on the selected repository host. Credentials stay there. Creation never pushes. Checkout/worktree actions require confirmation; checkout protects dirty and ignored local files.

Inspect `prList`, `prRead`, `prMutate` schemas before calling. Mutations require explicit confirmation and expected head (creation excepted). Read-only inspection does not authorize writes. Drafts persist locally by head; uncertain failures retain drafts. Refresh and reconcile before retrying. GitHub rules apply; no administrator bypass.

Threads and metadata candidates cover bounded first pages; incomplete coverage prevents readiness. A matching-head null rollup plus empty REST check/status arrays means no CI, while unavailable or inconsistent coverage is unknown. Binary/large patches cannot accept inline drafts. Split view shows patch columns, not full source. Merge queues depend on GitHub auto-merge; separate queue enrollment is unavailable.

Verification: local Git and fake mutation tests, live read-only GitHub schemas, build and installed reload. No live PR writes tested. Component screenshot QA does not establish authenticated installed full-page/thread-pane QA, which remains unverified. Detailed evidence is under artifacts/git-workbench-merge-control.


## Pull request inbox

Opening Pull requests shows a detailed, keyboard-accessible inbox. Rows show GitHub title/number, state, author initials, source → base, a plain-text description preview, up to ten labels, update date, and reported CI/review summaries. Choose a row to open Merge control; **Back to pull requests** preserves the search, state and page. Search is debounced by 300 ms. Changing a query hides old results until its response arrives. Open includes drafts; Closed excludes merged PRs; Merged and All have separate filters. Lists sort by recently updated, with at most 50 results per page. The page count is not an archive total.

Inbox health uses one bounded GraphQL batch for the page, without fetching each PR's full checks or details. It is a reported aggregate, not merge readiness. Missing/failed hydration or a mismatched head shows unavailable health and keeps the PR selectable. A null rollup says “no checks reported”; it does not mean success. Review “not reported” does not mean approved. Selecting a PR loads authoritative detail and existing conservative merge guards. Labels and previews are intentionally capped; full content remains in detail/GitHub. GitHub search indexing and updates between list/detail reads can affect freshness.


## New repository checkout

**Clone repository…** creates a new default-branch checkout from HTTPS or SSH on the selected connected machine, registers it as a BB project, and opens its verified catalog identity. Creation has explicit confirmation, per-request binding, duplicate suppression and exclusive destination promotion. Existing paths are preserved. Progress survives view navigation; registration retries reuse only the original verified clone. See README.md for the flow and recovery limits.
