# CLI Reliability and Capability Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. Keep the existing uncommitted desktop and CLI work intact.

**Goal:** Complete the requested CLI reliability, governance, history, integration and regression features without adding gateways, schedulers or autonomous learning.

**Architecture:** Preserve the shared agent/tool implementation and add focused CLI modules for Git, request governance, hooks, checkpoints, exports and localization. All model requests, including summaries and children, pass through one per-task governor. Validate real behavior in temporary repositories and local HTTP servers, then run bounded real-model tasks and an extracted release.

**Tech Stack:** Node.js, node:test, existing Commander/TUI, Git, existing LSP, existing snapshot object store and ZIP packager.

## 1. Existing P0 behavior

- [x] Run `node --test tests/cli-reliability.test.js tests/runtime-settings.test.js tests/cli-live-controls.test.js`: 29 pass.
- [x] Verify search filters, cancellation, diff-before-write, revision conflicts, real diagnostics and iterative compression.
- [x] Add stable English machine events/errors in `cli/machine-output.js` and subprocess tests. Keep user/model content unchanged.

## 2. Git and command discipline

- [x] Add `tests/cli-git.test.js`: initialize a temporary Git repository, stage a literal filename, inspect structured status/log/diff, reject traversal and option injection.
- [x] Implement `cli/git-tools.js` with fixed argument arrays, bounded output, `--literal-pathspecs`, no commit/reset/checkout and explicit stage approval.
- [x] Test and suppress standalone no-op commands such as `exit 0`; do not reject meaningful compound commands.

## 3. Provider governance

- [x] Add `tests/cli-model-runtime.test.js` using local HTTP endpoints for fallback before output, no replay after partial output, reservation competition, unpriced providers and budget exhaustion.
- [x] Implement `cli/model-runtime.js`; route `providers.streamChat` through the optional per-task controller.
- [x] Expose `--max-cost`, configured input/output rates per million tokens, output limits and fallback profiles; emit cost/fallback events.

## 4. Hooks and restricted execution

- [x] Add real process tests for hook denial, post failures, timeouts, signal cancellation and sanitized environment.
- [x] Implement `cli/tool-hooks.js`; load only the user's CLI-home configuration, never execute repository hooks implicitly.
- [x] Add `--sandbox restricted` with explicit built-in file write allowlists, host MCP/LSP retained and honest shell/MCP boundary reporting.

## 5. Session checkpoints and export

- [x] Reuse `src/services/turn-history.js` through `cli/session-history.js`; test undo/redo, conflicting user edits, interrupted tasks and cross-root mutations.
- [x] Wire checkpoint records into successful and failed turns; protect session operations with existing locks.
- [x] Implement recursive redacted JSON export in `cli/session-export.js` with version metadata, exclusive destination writes and no mutation of saved sessions.
- [x] Add `/undo`, `/redo`, `/export`, and noninteractive equivalents.

## 6. Locale and regression gate

- [x] Add explicit/system language selection for English, Chinese, Japanese, Korean and Spanish in `cli/i18n.js`; localize host UI only.
- [x] Add fixed repair/search/edit tasks and independent acceptance checks under `cli/eval/`.
- [x] Run fixture tests as protocol regression, distinctly labeled; run real model eval with recorded model/endpoint, source hash, usage, elapsed time and failure outcomes.
- [x] Update Actions to run TUI, full core suite, eval harness and extracted ZIP installation. Keep paid live eval behind configured secrets/manual dispatch.

## 7. Distribution and reporting

- [x] Include every new runtime/test/eval file in `src/services/cli-package.js` and the standalone package checks.
- [x] Run `npm run test:all`, `npm run test:cli-tui`, `npm run test:cli-package` and `git diff --check`.
- [x] Update CLI usage, reliability and evaluation reports with actual results and bounded limitations. No publish or remote CI success claim without execution.

Implementation commands for each new test file:

```powershell
node --test tests/cli-git.test.js
node --test tests/cli-model-runtime.test.js
node --test tests/cli-tool-hooks.test.js
node --test tests/cli-session-history.test.js tests/cli-session-export.test.js
node --test tests/cli-machine-output.test.js tests/cli-i18n.test.js tests/cli-eval.test.js
```

For each module: first run its behavioral tests and confirm failure due to the missing behavior; implement the module and rerun to pass before integration. Do not commit unrelated existing changes.

## 8. Follow-up integration review — 2026-09-27

- [x] Reproduce and fix missing hook coverage for workspace/mode/delegation tools; verify a denied delegation sends no child request.
- [x] Reproduce automatic-retry budget undercounting; account for ambiguous attempts and reserve again before transport retries, without charging canceled unsent attempts.
- [x] Check eval policy before task execution; bind saved credentials to endpoint/format and rates/context to model identity.
- [x] Preserve observed usage and cost in failed eval reports; do not double-count cumulative streaming packets.
- [x] Rerun full/core/TUI regression suites and retain previous real-model failures.
- [x] Verify the updated ZIP/npm distribution and finish the follow-up verification report: 113 standalone tests, 112 pass, 1 Docker skip; both installation checks passed.
