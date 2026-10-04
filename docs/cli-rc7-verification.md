# CLI 0.2.0-rc.7 verification

Date: September 27, 2026. Release scope: standalone CLI only.

## Fixes

- Exact-project session namespaces, canonical-directory trust before project
  reads, and preservation of matching legacy sessions.
- Request-scoped notification cancellation and silent noninteractive runs.
  Incomplete, blocked, or canceled model output cannot report task completion.
- Automatic limits and reasoning choices for the exact model IDs documented in
  `cli-model-capabilities.md`. Existing known profiles receive refreshed limits.
  Custom deployments retain explicit configuration.
- Context compression reserves response space, reduces old results and reasoning,
  and preserves current requests, denied operations, and saved conversation data.
- Up to three automatic output continuations within existing task and cost
  limits. No tool call from a truncated response is executed.

## Verified evidence

Tested source commit: `57f6f473366d8ceaf008c5a07520b36a7d5b93cd`.

GitHub PR CI: https://github.com/JiuYue0820/achernar-code/actions/runs/36295898055

| Check | Result |
| --- | --- |
| Standalone tests | 185 passed, 1 opt-in Docker test skipped locally |
| TUI tests | 96 passed |
| Shared development application/service tests | 76 passed |
| Fresh tarball installation | 15 checks passed |
| Deterministic task fixtures | 5/5 |
| Windows, macOS, Linux on Node 22 and 24 | All six CI jobs passed |
| Dedicated real Docker CI job | Passed |
| Lint and format checks | Passed |

Installation checks execute actual file operations, a shell command, LSP
diagnostics, bundled MCP, checkpoints, session deletion, project isolation, trust
refusal, and export. They also check that desktop source is absent.

The test model for this release is `deterministic-protocol-fixture`, a local HTTP
fixture. These results verify integration behavior, not model quality. The live
model regression workflow was not requested for this release and was skipped.
No new live-model benchmark or product ranking is claimed.

## Artifact identity

The published tarball is copied from the exact successfully installed and tested
tarball; it is not rebuilt after verification. Its SHA-512 integrity also matches
the Windows Node 24 CI package output.

| Artifact | SHA-256 |
| --- | --- |
| `achernar-code-0.2.0-rc.7.tgz` | `e848fdc3816b3e0fddd2b62b9f79fdd8bec63ef1657454166957dcd473ee4757` |
| `achernar-code-0.2.0-rc.7.zip` | `196a5d629037b031c05683714f61a4adfa1831cc38000cce1b0066ad70a01324` |

The ZIP is the CLI-only install distribution. The GitHub source repository
additionally includes verification scripts and CI; those scripts are not npm
runtime files.

## Boundaries

- The capability catalogue is bounded and dated, not automatic discovery of every
  future model. Unknown endpoints are not assigned guessed vendor capacities.
- Pending Windows notification helpers are canceled when a request is answered.
  An already-displayed Windows toast is not explicitly removed from notification
  center.
- Extremely large current requests or unresolved arguments can still exceed
  context. They produce an explicit error while preserving saved history.
- npm registry publication still requires publishing authentication. GitHub
  distribution does not imply the package has been published to npm.
- Desktop UI is not released by this change.

See the release's `verification.json` for merged commit, tag workflow, and public
download installation results.
