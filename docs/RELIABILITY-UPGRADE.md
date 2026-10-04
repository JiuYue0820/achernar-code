# Achernar reliability and capability work

This is a working implementation checklist, not a completed-feature claim.
Public evaluation remains Achernar-only and identifies model, protocol, environment,
failures and assisted continuations.

## Already implemented in the rc.3 candidate

- [x] CLI-only tool/agent entrypoints; no shipped desktop-control implementation.
- [x] Bundled real JS/TS LSP with bounded read-only queries.
- [x] Shell selection, opt-in Docker terminal isolation with fail-closed behavior.
- [x] VS Code tasks and portable hashed extension bundles.
- [x] Independent CLI GitHub repository and multi-platform CI.
- [x] Main desktop/workspace repository initialized locally.
- [ ] Final rc.3 package test refresh after explicit host selection in legacy tests.
- [ ] Publish next tested CLI candidate; npm registry login still requires user interaction.

## Reliability work requested in review

- [ ] Shared validated runtime settings, surfaced in CLI and desktop.
- [ ] HTTP retry/backoff, Retry-After, cancellation and no replay after partial streaming.
- [ ] Configurable command/task deadlines.
- [ ] Isolation option preserving useful coding capabilities, with honest boundaries.
- [ ] Regex and include/exclude glob search with bounded execution.
- [ ] Unified diff approval preview.
- [ ] Automatic diagnostics after source edits, reported to the next model turn.
- [ ] Structured Git status/diff/log/stage tools with permission enforcement.
- [ ] Bounded iterative context compaction, preserving latest request and tool-call pairing.
- [ ] Per-model prices, task budgets, visible cost estimates and a spending stop.
- [ ] Explicit fallback provider chain, with no silent replay or unconfigured data transfer.
- [ ] Version-aware read cache with fresh file checks.
- [ ] CLI task checkpoints and undo/redo with conflict protection.
- [ ] Explicitly configured hooks and shared plugin lifecycle.
- [ ] CLI language preference and translated user-facing controls/notifications.
- [ ] Reproducible live-model evaluation runner and actual fixed-task results.
- [ ] Main project baseline commit and CI.

## Work products, memory and extension ecosystem

- [ ] Desktop PPTX creation/export, validated elements, official Skill and actual output checks.
- [ ] Shared CLI/desktop extension import/export and settings with clear trust/enable state.
- [ ] Searchable provenance-aware memory with deduplication, conflicts, revisions and token budgets.
- [ ] Reviewed, reversible learning from verified task outcomes; no claim of weight training.
- [ ] Research notes grounded in original Hermes source, A-MEM, Mem0 and AgeMem.
- [ ] Verify workflows for coding and document work; report capability gaps without ranking claims.

Never publish desktop/private runtime data as part of the standalone CLI.
