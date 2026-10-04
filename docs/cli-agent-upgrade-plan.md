# Achernar CLI agent experience and comparison

Goal: improve an existing working CLI through clearer output, live task steering and concise evidence-driven instructions; compare real runs against OpenCode with the same free model.

Architecture: keep existing tools and live permission enforcement. Add a bounded per-run inbox consumed only at model/tool boundaries; structured response-phase and completion events provide truthful UI status. Keep settings and history local. No new framework or dependency.

Implementation and acceptance:

- Add `cli/agent-policy.js` with host-specific instructions: PowerShell on Windows, selective reads, apply project guidance, use files for changes, inspect actual command results, continue through verification, concise final response. Remove competing desktop-only prompt guidance from CLI runs through a host flag.
- Add `cli/task-inbox.js`, wire the running editor through `onSteer`, and drain through `runAgent.takeMessages`. Preserve order and explicit live permissions; cancellation restores unconsumed input. Tests cover steering after tools and before final completion, bounded capacity and canceled input.
- Add response phase and execution summary events in `src/services/agent.js`. UI distinguishes interim updates from final text and lists actual changed paths and command exit status. Never infer test success from generated prose.
- Add `/details` and `/thinking` preferences, keyboard shortcuts and in-progress controls. Show/hide changes display only, not model reasoning configuration or stored text.
- Preserve previous changes: native completion/attention notifications, configured-only model picker with lazy discovery, foldable cards, session deletion with lock checks.
- Run focused Node tests, existing suite, Electron notification runtime test, cell-grid screenshot review and CLI PTY checks. Rebuild downloadable ZIP.
- Compare identical synthetic Node tasks in fresh directories under `D:\User\Desktop\Project\Test-CLI`, with fixed external acceptance tests and no private project data. Use `opencode/space-bunny-free` and Achernar's direct endpoint for the same model. Preserve both failures and successes, raw events, commands, model/version and measurement limits. Do not infer general agent rankings from this small sample.

Research: OpenCode official Agents/TUI/Zen documentation fetched 2026-09-26; Pi installed README v0.85.1; Claude Code official best practices. Codex official webpage fetch returns 403 in this environment, so locally installed `codex --help` / `codex exec --help` v0.154.0 are the verified source for session, queue, permission and JSON-event surfaces. Source copies and benchmark evidence live in the requested Test-CLI directory.

Completed: implementation, source tests, native notification/PTY checks, real OpenCode and Achernar free-model runs, and rebuilt ZIP. Full results and failed runs: `D:/User/Desktop/Project/Test-CLI/REPORT-20260926.md`.

Added during evaluation: three original runnable official UI templates, native guarded template copy and pre-approval preview; bounded historic tool evidence for CLI resume, preserving full local records. Real UI invocation and 17 browser checks verified; first run did not finish, both hosts needed bounded evaluator-assisted continuation. CSV still failed to finish within the equal time budget despite usable files. No general ranking claim.
