# CLI Workbench and Regression Gates Implementation Plan

**Goal:** Make existing coding capabilities discoverable and usable through terminal controls, improve code input/output, and address the supplied regression/isolation checklist.

**Architecture:** Keep the existing Node terminal renderer and agent runtime. Add a command workbench for read-only inspection, reuse existing pickers and expose a scrollable viewer. Extend eval with explicit model/task matrices. Add Windows Job Object process limits as a distinct execution mode, with accurate boundaries and no silent host fallback.

**Tech stack:** Existing Node/Commander/TUI, node:test, local HTTP fixtures, PowerShell and Windows Job Objects, GitHub Actions.

The user authorized implementation. Keep all previous uncommitted work. No unrelated commits or cleanup. CLI remains the product under test; no competitor comparisons.

## Input and discovery

- [x] Test vertical grapheme/cell-aware cursor movement, word editing, multiline paste, draft preservation across dialogs, and command palette selection.
- [x] Implement these in `cli/tui-input.js` and `cli/tui.js`, preserving slash prefix matching and live approval controls.
- [x] Add `/commands` / Ctrl+P, grouped `/settings`, `/files`, `/search`, `/git`, `/diff`, `/doctor`, `/cost`, `/output`, `/agents`, `/output-limit`, `/stop` discoverability and handler tests.

## Output and workbench

- [x] Implement a bounded read-only viewer with keyboard/mouse scrolling, code/diff colors and escape-to-return.
- [x] Browse project files without model calls, inspect changed files and run bounded search through existing services.
- [x] Preserve source text and indent in code output; distinguish tool summary from raw result JSON.
- [x] Test narrow screens and render actual terminal-cell previews for visual inspection.

## Regression and isolation

- [x] Add fixed-task matrix eval for multiple explicit model profiles, preserving failures and exact model metadata.
- [x] Configure an explicit required live-eval gate without secrets on untrusted PRs; retain fixture as engineering verification.
- [x] Run bounded live eval only with configured credentials; retain unavailable/failed results.
- [x] Implement and test Windows Job Object process/memory limits and child cleanup without disabling MCP/LSP. Clearly distinguish process resource limits from filesystem/network isolation.
- [ ] Remote CI success remains unconfirmed: query failed with a host connection-aborted error; current workspace has no remote and was not pushed.

## Delivery

- [x] Include every new runtime asset/test in standalone ZIP/npm packaging.
- [x] Run full CLI/TUI/package regression and update usage, entry-point audit, limitations and measured results. See `docs/cli-workbench-verification.md`.
