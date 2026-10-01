# Reliability implementation status

This records the requested review items against the current local candidate. It is not a product ranking, production certification or remote CI result.

| Review item | Current status and boundary |
| --- | --- |
| P0.1 Request retry/backoff | Implemented: bounded attempts, jitter, Retry-After, cancellable waits; no replay after response streaming starts. |
| P0.2 Command timeout | Implemented: default 10 minutes, override up to 1 hour, task deadline remains authoritative. Configurable in CLI and desktop. |
| P0.3 Intermediate isolation | `restricted` enforces built-in file write roots. Windows `--sandbox job` additionally limits terminal process count and committed memory, starts the command suspended before Job assignment and kills descendants on exit; assignment failures have no host fallback. Host MCP/LSP remain available. Job limits do not isolate filesystem/network access or reduce user privileges. Docker remains the isolated terminal option. |
| P0.4 Version control | The project is a Git repository with a baseline commit. This candidate remains reviewable as local working changes. |
| P1.5 Search | Implemented: regex, include/exclude glob patterns, case-sensitive matching, bounded results, worker timeout/cancellation. |
| P1.6 Diff approvals | Implemented for text writes/edits, including template copies; scrollable preview, stale-revision protection, no file changes on denial. Arbitrary shell changes do not have automatic diff previews. |
| P1.7 Automatic diagnostics | Implemented for file-tool writes/edits. JS/TS: LSP in CLI and compiler worker on desktop; JSON: parser. Unsupported/disabled/unavailable validation is explicit. Does not replace full builds/tests or automatically validate arbitrary shell changes. |
| P1.8 Native Git tools | Structured status/diff/log/stage, literal pathspecs, bounded output and sanitized Git routing variables. Stage requires explicit paths and live approval; no commit/reset/clean operation is exposed. |
| P1.9 Context compaction | Summary failure falls back to progressive result trimming. Completed tool groups can be retired together when old arguments fill context; user constraints, pair integrity and denials survive. An oversized irreducible request/system/unresolved tool payload produces a specific actionable error. |
| P1.10 Dollar budget | Explicit USD rates per million input/output tokens and shared per-task reservations, including summary/subagent calls. `--max-cost` stops further requests. Unknown prices are not free. Interrupted/unreported usage is conservative; provider invoices can differ from client estimates. Switching models clears unrelated pricing. |
| P2.11 Provider failover | Configured chain for HTTP 4xx/5xx and connection errors before any text, reasoning or tool delta. Partial streams are never replayed. Actual model is recorded; context fits the smallest candidate window. Credentials and rates are per endpoint. |
| P2.12 Read cache | Implemented per toolset/task with byte hashes and requested-range keys. Disk is reread to check freshness; repeated unchanged content is omitted from tool results. `fresh:true` returns it again. This reduces repeated model context, not disk I/O. |
| P2.13 CLI checkpoint/undo | `/undo` and `/redo` restore task files plus conversation using real snapshots, locks and recoverable journals. Refuse later user-edit conflicts. Default limit is 256 MB/20,000 entries; insufficient snapshots and external Git indexes report unavailable. Out-of-project side effects cannot be undone. |
| P2.14 User hooks | Explicit user-home tool_pre/tool_post scripts with JSON stdin, sanitized environment, timeout and cancellation. Pre refusal/failure prevents execution; post failure warns without changing the original result. No implicit repository hook loading. |
| P2.15 CLI language | Main TUI controls and notifications support en/zh-CN/ja/ko/es, defaulting to system locale with `/language` override. Technical details and untranslated help fall back to English. JSON/JSONL host status/message/error fields stay English, while user/model data keeps its language. |
| P2.16 Live-model regression | Five fixed coding tasks with independent acceptance, threshold exit status, exact model/endpoint, hashed source-file list, tokens, elapsed time and failures. `--models` evaluates multiple model IDs independently. Two models were exercised; 429 failures remain in the denominator. See EVALUATION.md. |
| P2.17 CI | Push/PR workflows include complete core/TUI tests, fixture eval and ZIP/npm installation checks. Default-branch pushes require the real-model matrix; missing setup fails rather than silently switching to fixtures. Manual dispatch supports the same gate. Remote validation for this working tree is still unconfirmed. |
| Session share/export | `/export` and `achernar export` produce versioned redacted JSON without changing source history or overwriting existing destinations. Credentials, attachments, known local paths and common secret patterns are removed. Review natural-language privacy before sharing. |

## Settings that actually run

- Request retries, initial/max backoff, provider request timeout.
- Default command timeout and overall task timeout.
- Automatic file diagnostics and revision-aware read-result deduplication.

CLI: `/settings` or `achernar settings <key> <value>`.
Desktop: program settings → task runtime. The two applications share validation/defaults but keep independent configuration files. Approval modes remain live controls.

CLI additions: `/pricing`, `/budget`, `/fallbacks`, `/hooks`, `/language`, `/undo`, `/redo`, `/export`. See USAGE.md for their noninteractive equivalents and configuration examples. No gateway, scheduler, cloud backend, PPT engine or autonomous learning loop was added.

## Verification

Run in the source checkout:

```text
npm run test:all
npm run test:reliability
npm run test:cli-tui
npm run test:cli-core
npm run test:cli-package
npm run eval:cli -- --fixture --out output/fresh-fixture-directory --threshold 1
npm run eval:cli -- --live --out output/fresh-live-directory --threshold 1
```

`test:cli-package` extracts to an external temporary directory, installs the pinned dependency graph, runs standalone tests, then packs and installs the npm artifact in a second directory before verifying it. It never publishes.

Local HTTP fixtures explicitly use `runtime-fixture`, `package-fixture`, or `fixture` model IDs. They verify protocol flow, retries, approvals and validation feedback, not language-model capability or comparative rankings.

Both project and standalone workflows include a `Live coding regression` job on manual dispatch with `live_eval` selected, or on default-branch pushes when `ACHERNAR_LIVE_EVAL_ENABLED=true`. This opt-in consumes provider credits. It runs `node cli/eval/ci.js`, requires every configured model to pass all five tasks, and preserves failed reports. Configuration:

- Secret `ACHERNAR_EVAL_API_KEY`.
- Variable `ACHERNAR_EVAL_BASE_URL`.
- Variable `ACHERNAR_EVAL_MODELS`: 2–8 distinct comma-separated model IDs on that endpoint.
- Optional variable `ACHERNAR_EVAL_API_FORMAT`, default `openai-chat-completions`.

Missing settings fail the gate. `ACHERNAR_EVAL_MODEL` and `ACHERNAR_EVAL_ENABLED` are no longer used by this gate. Pull-request events never receive model credentials; maintainers can evaluate a reviewed branch with manual dispatch. A skipped PR live job is not evidence that the model regression passed. Configure repository branch/ruleset requirements separately if merge protection is desired; this local change does not configure GitHub rules. Model requests consume provider quota, with per-task round/time limits. The job's 25-minute total limit is authoritative.

## Follow-up integration fixes — September 27, 2026

- Hooks also cover workspace controls, execution-mode changes and delegation. Denied delegation cannot start a child model request; child tool calls retain their own hooks.
- Cost reservations apply to each transport attempt. An ambiguous dropped connection is charged conservatively before retrying; insufficient remaining budget blocks the next request. Canceling during backoff does not charge an unsent attempt.
- Standalone eval validates its threshold and budget before running tasks. Saved credentials remain bound to their endpoint/format, and saved prices/context remain bound to their model.
- Failed eval reports retain observed usage and the last cost event with `usageComplete:false`. Cumulative streaming usage updates are counted once per response.

These fixes are covered by local HTTP/process tests, including a deliberate HTTP 429 case. Those tests are protocol regression checks, not new live-model quality measurements. The previous live-model results and their failures remain unchanged in EVALUATION.md.

## Workbench continuation — September 27, 2026

- Ctrl+P / `/commands` and grouped `/settings` expose existing capabilities. Exact command matches rank ahead of description-only matches.
- `/files`, `/search`, `/git`, `/diff`, `/doctor`, `/cost` and `/output` have local terminal interactions; source/diff viewers support scrolling, line numbers and code colors without model calls. Source viewing is read-only and bounded to 128 KiB.
- Multiline input handles wide characters and word navigation. Dialogs preserve the draft and cursor. `run --stdin` / `--task-file` preserve multiline code and have installed-package checks.
- `files.edit` accepts `newText` as an alias for `content`; conflict detection, diff approvals, revision checks and automatic diagnostics are shared. Invalid argument errors identify rejected fields and expose `INVALID_TOOL_ARGUMENTS`.
- Standalone packaging now includes task-input and Windows Job runtime files. The installed package retains 13 official Skills and 7 Plugins and excludes desktop control.
- The desktop workspace has no Git remote. CLI-only source is pushed separately to `JiuYue0820/achernar-code`. Remote CI must be inspected for each release; local passing checks alone do not establish it.
