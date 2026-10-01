# CLI engineering

The CLI uses the existing Node/CommonJS runtime. Module boundaries now separate:

| Responsibility | Module |
| --- | --- |
| Command dispatch and help | `chat-commands.js`, `help.js`, `workbench-commands.js` |
| Terminal keyboard routing and selection | `tui-keyboard.js`, `tui-selection.js` |
| Model actions and reasoning | `model-picker.js`, `model-actions.js`, `reasoning-menu.js` |
| Persistent configuration and change invalidation | `config-store.js`, `settings-save.js` |
| File mutation policy | `mutation-policy.js` |
| Error classification at process boundary | `errors.js` |
| Release detection and user update interaction | `updates.js`, `update-menu.js` |

`index.js` still composes the runtime and process commands. This is an incremental extraction, not a claim that all orchestration has been moved out.

Checks at tool entry, after approval and after user hooks intentionally remain. Mode or permission state can change across these awaits. A shared mutation helper removes duplicate code without removing the checks.

Configuration reads cache parsed JSON by file identity/size/nanosecond timestamps. Callers receive independent objects. Streaming redaction does not reload configuration or decrypt credentials for each token.

```powershell
npm ci --ignore-scripts
npm run lint
npm run format:check
npm test
npm run test:cli-coverage
npm run test:package
```

Lint and formatting gate CI. Coverage is measured and reported; there is no invented claim of full coverage or arbitrary threshold. Unit tests cover configuration invalidation, credential binding, reasoning persistence, machine error categories, update channels/cache, and interaction behavior. Integration tests exercise installed files, MCP, real JS/TS diagnostics, mutation policy, task history and package resources.

The standalone package check packs the npm tarball, installs outside the source checkout, and runs a deterministic HTTP fixture. Fixture success is not a model quality measurement.

Windows is locally tested. The runtime candidate passed all six GitHub matrix jobs (Windows/macOS/Linux, Node 22/24) and the real Docker job in run `36292085382`, commit `763ccb7e03c99096a4f24f1bcab216332d296c56`. The optional live-model CI job was skipped; separately recorded local model runs are described below. Native terminal visual behavior and OS clipboard integrations require host-specific testing beyond cell-grid previews.

Release procedures: [UPDATES.md](UPDATES.md). Measured model runs: [EVALUATION.md](EVALUATION.md).

Live CI evaluation is opt-in because it consumes a maintainer's provider credits. Use a manual `live_eval` dispatch, or set `ACHERNAR_LIVE_EVAL_ENABLED=true` plus the documented model/endpoint variables and API-key secret for default-branch pushes. An enabled live run fails if its configuration is incomplete; it never substitutes fixture success. Regular commits always run the deterministic checks. The published local model reports remain separately identified.

## Local checks on September 27, 2026

- ESLint and Prettier checks passed.
- CLI coverage run: 144 tests, 143 passed, one Docker opt-in skip, zero failures. Measured line/statement coverage 79.26%, branch coverage 78.49%, function coverage 86.36%.
- Shared agent/provider/search/package regression: 32 tests passed.
- Standalone candidate: extracted outside the source checkout, clean `npm ci`, lint/format, 155 tests (154 passed, one Docker opt-in skip), then npm pack/install and 13 installed behavior checks passed. An additional release metadata regression subsequently passed locally.
- Fixture coding suite: 5/5 passed. Real model results are in `EVALUATION.md` and are not included in the fixture score.
- Cell-grid previews were inspected at wide and narrow sizes, including Chinese/Russian controls and busy slash suggestions. These are renderer previews, not native terminal screenshots.
- Live short and mixed-language web queries both returned parsed results through fallback search. This does not establish that every website is reachable.
- Subsequent cross-platform fixes cover missing evaluation parent directories, canonical LSP roots, framed Windows helper input, CMD quoting and required Windows startup environment variables. Tests reject execution timeouts and ensure credentials and Node injection options are excluded from the restricted process environment. The remote runtime candidate passed the full matrix and Docker checks identified above.
