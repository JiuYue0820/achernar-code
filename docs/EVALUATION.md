# Achernar CLI evaluation

These are **Achernar's own measurements only**. This report contains no competitor results, compiler comparisons, ratings or rankings.

## Reasoning regression — September 27, 2026

Endpoint: **`https://api.deepseek.com`**, OpenAI-compatible Chat Completions. The IDs below are exactly those sent to the API, not inferred model weight revisions. Windows, Node 24.15.0, isolated synthetic projects, automatic approval, no subagents.

| API model | Reasoning value | Scope | Passed | Sum of task times | Input tokens | Output tokens | Estimated USD |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| `deepseek-flash` | `low` | Full five-task suite | 5/5 | 26.235 s | 83,528 | 2,538 | 0.028104 |
| `deepseek-v4-pro` | `high` | Full five-task suite | 5/5 | 47.999 s | 90,956 | 2,975 | 0.131843 |
| `deepseek-flash` | `none` | Typed edit only | 1/1 | 4.614 s | 16,201 | 387 | 0.005325 |
| `deepseek-v4-pro` | custom label → `max` | Typed edit only | 1/1 | 6.132 s | 12,040 | 340 | 0.017239 |

Full suite: JSON repair, multi-file receipt calculation, clamp boundary repair, regex/glob search and TypeScript edit with automatic diagnostics. Each task had a 120-second deadline, 4,096 output-token limit and $0.20 configured budget; full suites allowed ten rounds, targeted checks eight. None required evaluator-assisted continuation.

Costs use configured conservative rates per million tokens: Flash $0.30 input/$1.20 output; Pro $1.32 input/$3.96 output. They are estimates from reported usage, not provider invoices; no cache discount is applied.

The OpenCode Zen endpoint `https://opencode.ai/zen/v1` returned **HTTP 401** when checking the supplied credential. No new task was evaluated with it. This failure is retained rather than replaced with a fixture score.

[Full machine-readable evidence](evaluation/reasoning-20260927.json) includes per-task acceptance, budgets, tokens, times, cost calls and source fingerprints. Runs preceded final formatting/packaging refactors; they do not by themselves verify every byte of the eventual published package. These small fixed tasks establish integration evidence, not broad capability or a ranking.

## Fixed reliability suite — September 26, 2026 (UTC)

**Actual model: `agnes-3.0-flash`, endpoint `https://apihub.agnes-ai.com/v1`, OpenAI-compatible Chat Completions.** Model weight revision was not independently verified. Windows/Node.js 24.15.0, isolated synthetic projects, automatic approval, no subagents, at most 12 responses and 120 seconds per task. These are small local coding tasks, not a general capability benchmark.

| Attempt | Task | Wall time | Tool calls | Reported main-agent tokens | Outcome |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | Clamp boundary repair | 24.002 s | 4 | 17,453 | Passed; independent boundary assertions and original checks preserved |
| 1 | Regex / include / exclude | 10.108 s | 2 | 12,605 | Passed; exact artifact paths and unchanged source files |
| 1 | Typed edit / automatic diagnostics | 6.442 s | 2 | 12,324 | Passed; numeric export and clean automatic diagnostics |
| 2 | Clamp boundary repair | 13.339 s | 5 | 21,844 | Passed |
| 2 | Regex / include / exclude | 14.350 s | 3 | 17,235 | Passed |
| 2 | Typed edit / automatic diagnostics | 7.709 s | 2 | — | Failed to complete: provider HTTP 429; counted as a failed task |

Attempt 1 passed **3/3**. Attempt 2 passed **2/3** and the `--threshold 1` regression gate correctly exited nonzero. Both attempts are retained: **5/6 completed task attempts**, with one provider-limited completion. This is not a stable pass-rate estimate, ranking or performance promise. The failed attempt's file acceptance is separately recorded in the JSON; artifact correctness alone does not turn a failed run into a completed task.

No confirmed model price was configured, so dollar cost is recorded as **unknown**, never zero. Failed-run aggregate tokens are unavailable in that report. These measured source snapshots precede a final error-message clarification; exact source fingerprints and timestamps remain in the evidence.

- [Attempt 1 JSON](evaluation/reliability-agnes-r1.json)
- [Attempt 2 JSON, including the failure](evaluation/reliability-agnes-r2.json)
- Fixed prompts, seed files and independent checks: `cli/eval/tasks.js`
- Reproduce: `achernar eval --live --out <fresh-directory> --threshold 1`

`--fixture` runs a deterministic local HTTP protocol fixture and must not be cited as a real-model quality score. The new release pipeline separately exercises ZIP extraction, dependency installation, npm packing, clean npm installation and CLI execution.

## Earlier development measurements

## Model and test setup

| Field | Recorded value |
| --- | --- |
| Model ID sent to the API | **`space-bunny-free`** |
| Model service | **OpenCode Zen** |
| Compatible endpoint used | `https://opencode.ai/zen/v1` |
| Protocol | OpenAI-compatible Chat Completions |
| Task run date | **2026-09-26** |
| Host | Windows, PowerShell, Node.js 24.15.0 |
| Tool host under evaluation | Achernar CLI development build |
| Approval policy | Automatic, in separate synthetic test projects |
| First attempt time budget | 240 seconds |
| UI first attempt additional limit | 24 model rounds |
| Network restriction | The tasks prohibited tool browsing/downloads; model API traffic remained necessary |

The service and endpoint identify the **model provider**, not another CLI being compared. The model's underlying weight revision was not independently verified. Availability of this provider alias can change; the report does not guarantee it remains available.

These runs predate the `0.2.0-rc.2` packaging revision and its latest round-budget hints. They are retained development evidence, **not fresh performance runs of this exact release tag**.

## Task results

Elapsed time is process wall-clock time, including model waits and tools. Token totals are the provider-reported cumulative usage available for that attempt, not peak context size. `—` means unavailable, not zero.

| Task / attempt | Elapsed | Tool calls | Reported total tokens | Checks and deliverables | Task state |
| --- | ---: | ---: | ---: | --- | --- |
| Repair `summarize(items)` | 77.769 s | 13 | 105,864 | 11 tests and independent acceptance passed | Completed |
| CSV utility, first attempt | 240.036 s | 8 recovered events | — | Artifact acceptance passed; **0 tests discovered** | Timed out; incomplete |
| CSV utility, continuation | 240.043 s additional | 13 | — | 24 tests and independent acceptance passed | Timed out; no final answer |
| Reading-list UI, first attempt | 204.408 s | 27 | — | HTML produced; README missing | Stopped at 24-round limit |
| Reading-list UI, assisted continuation | 90.093 s additional | 16 | 461,653 | README completed; 17 independent browser checks passed | Completed with evaluator assistance |
| Compact-history summary request | 13.546 s | 0 | 9,489 | Provider reported 8,504 input + 985 output tokens | Summary returned; not a coding task |

The CSV task used 480.079 seconds across two attempts and still did not complete the conversation. The UI task used 294.501 seconds across its first attempt and continuation. These totals are not repeated-trial averages.

The UI continuation received an independently generated validation JSON and an explicit instruction to finish missing deliverables. It must not be counted as an unaided first-attempt success. High cumulative token use in that continuation remains a limitation.

The history summary was a single no-tool request using compact prior execution records. It does not measure coding correctness, first-token speed or general task cost.

## Public evidence

- [Recorded metrics](evaluation/metrics.json): values curated from the individual Achernar run files, including missing measurements and stop reasons.
- [Task prompts](evaluation/tasks/): repair, CSV, reading-list UI and UI continuation instructions.
- [UI acceptance checks](evaluation/ui-acceptance.json): the 17 checks with their observed pass/fail values.
- Source tests in [`tests/`](../tests/) exercise terminal interaction, permissions, context handling and model fixtures.

The original CSV metrics mistakenly counted an exit-zero run with zero discovered tests as a successful test run. This report uses the corrected record: **0 tests is not tested**.

No personal sessions, credentials, private source projects, unrelated products' outputs or competitor logs are distributed as evidence.

## Candidate validation

Candidate installation checks use a **local deterministic HTTP fixture**, not `space-bunny-free`. They verify file writes, template copies, command results, official MCP execution, JSON/JSONL output, session restoration, denied approvals, read-only enforcement and recoverable round exhaustion.

The parent project's last full suite contained 163 tests: 161 passed, 2 native ASR environment tests were skipped. That count includes desktop tests and is **not the number of tests in this standalone CLI repository**. Use `npm test` here or inspect the GitHub Actions run for this repository's exact current result.

For this standalone `0.2.0-rc.2` candidate, the local Windows / Node 24.15.0 run passed **42/42 tests with no skips**, followed by **8 grouped acceptance checks** against an npm tarball installed outside the checkout. Those checks made 10 local HTTP fixture requests and discovered all 18 official Skills and 11 official Plugins. The fixture model ID was `package-fixture`; it is not an LLM and has no meaningful performance or token score.

The initial public [GitHub Actions run](https://github.com/JiuYue0820/achernar-code/actions/runs/36254934938) also passed all **six OS/runtime combinations**: Windows, Ubuntu and macOS, each with Node 22 and 24. Each job ran both source tests and installation acceptance. This adds automated cross-platform coverage; it is not a manual terminal, model-provider or native notification test on every OS.

`npm run test:package` creates the actual npm tarball, installs it outside the checkout and exercises the installed command. Its file allowlist check ensures tests, build scripts, local configuration and session directories are not included in the npm package.

## Interpretation

Single samples are sensitive to model randomness, network latency and service load. Passing artifact checks does not prove the entire task finished. A provider's usage totals can include repeated prompt input across tool rounds; they are not a simultaneous context-window size.

This preview still needs more fresh tasks, repeated trials and long-task completion work. The report makes no performance ranking or general speed/cost-saving claim.

## rc.3 engineering validation

No new LLM benchmark was run for rc.3. The historical model cases above still use **space-bunny-free through OpenCode Zen**; they are not rerun results for this candidate.

The local standalone suite contains 52 tests: **51 passed, 1 Docker integration test skipped** because the local Docker engine is not running. Real bundled TypeScript/JavaScript language-service tests cover definitions, references, types, diagnostics, updates, permissions and cancellation. Installed-package validation passed **9 grouped checks**, including actual compiler errors appearing and clearing after edits, without access to the source checkout. It discovers **13 official coding Skills and 7 CLI-compatible Plugins**. Package agent calls use the deterministic `package-fixture` HTTP fixture; language-service tests use TypeScript, not a model.

A separate Linux Docker CI job exercises mount boundaries, blocked network, read-only root filesystem and container cleanup. Its result must be read from the current GitHub Actions run, independently of the locally skipped check. Cross-platform validation remains automated; it is not a claim of manual native-terminal testing on every system.

## September 27 workbench matrix and edit regression

Real models: **`agnes-3.0-flash` and `agnes-2.5-flash`**, both through `https://apihub.agnes-ai.com/v1`, using OpenAI Chat Completions on Windows / Node 24.15.0. The expanded suite covers JSON configuration repair, two-file receipt calculations, clamp boundaries, filtered regex search and typed editing with automatic diagnostics. Each task starts in a fresh directory with independent checks.

| Run | Model | Passed / attempted | Observed failure |
| --- | --- | --- | --- |
| Matrix 1 | `agnes-3.0-flash` | 2/5 | Three HTTP 429 failures |
| Matrix 1 | `agnes-2.5-flash` | 0/5 | Four HTTP 429 failures; one edit-protocol acceptance failure |
| Matrix 2, after fix | `agnes-3.0-flash` | 2/5 | Three HTTP 429 failures |
| Matrix 2, after fix | `agnes-2.5-flash` | 0/5 | Five HTTP 429 failures |
| Targeted typed-edit rerun | `agnes-2.5-flash` | 1/1 | Passed; 7.878 seconds, three tool calls, 13,713 reported tokens |

Matrix 1 uncovered a real compatibility defect: the model supplied `oldText/newText`, which failed validation twice, then used a whole-file write. The resulting file was correct, but the requested `files.edit`/diagnostics flow failed acceptance and is counted as failed. After supporting the alias, the targeted rerun again used `oldText/newText`, successfully edited the file and received zero LSP diagnostics. The numeric API and untouched `tsconfig.json` also passed acceptance.

Both full matrices remain **2/10**, with failures in the denominator. The targeted run is a separate regression check; it is not substituted for any full-suite result. Models share one provider, most attempts were rate-limited, and these small tasks do not establish broad model or product quality. Provider pricing was not configured, so dollar costs are unknown, not zero.

Sanitized reports retain original timing, usage, failure status and source fingerprints:

- [First matrix](evaluation/workbench-matrix-r1.json)
- [Second matrix](evaluation/workbench-matrix-r2.json)
- [Targeted edit regression](evaluation/workbench-edit-fix.json)

Local paths and synthetic resume IDs are removed from these distributable copies. Original task files/events remain in the local Test-CLI run directories. This candidate's source tests and installed-package checks use deterministic fixtures separately from these real-model measurements. New CI gates require complete real-model passes; these recorded full runs do **not** satisfy that gate.
