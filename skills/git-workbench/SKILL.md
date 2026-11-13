---
name: git-workbench
description: Inspect or operate Git repositories through the Git Workbench BB plugin's validated RPC, or help use its visual client.
---

Open Git Workbench from BB's navigation rail or a thread's fixed Git Workbench tab. Select a project, then filter its branches or worktrees by typing. Branch selection browses history; worktree selection changes the active checkout. The plugin runs Git on that environment's machine.

Inspect exact schemas with `bb plugin rpc inspect git-workbench`. Use `bb plugin rpc call git-workbench <method> --input-file <file> --json` for repositories, snapshot, read, or mutate. Always inspect the contract first. Write JSON input to a unique file under thread storage. Do not supply undefined values; omit optional keys.

Read calls are bounded. Preserve and report any truncation flag. Never interpret a capped history as the complete repository. Mutations change the real repository and require authorization appropriate to the user's request. Destructive operations require `confirmed: true`; do not set it without the user's instruction authorizing that specific action. Merely inspecting Git does not authorize committing, pushing, deleting, or resetting.

The plugin does not offer complete JetBrains parity. Interactive rebase, three-way merge editing, clone/init, hosting-provider integration and submodule/LFS management are outside its current scope. Refer to the plugin README for current limits.
