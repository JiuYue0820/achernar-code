# Release Notes

## 0.2.0-rc.8

- Runtime settings, transient request retries, configurable command/task deadlines.
- Regex/glob search, scrollable diff approvals and automatic file diagnostics.
- Stable system prompt across rounds so provider prompt caches can hit.
- Request deadline measured as inactivity; task timeouts report a resume hint.

See [docs/RELIABILITY.md](docs/RELIABILITY.md) for the full list of implemented behavior and remaining work.

## 0.2.0-rc.5 through rc.7

Incremental candidates covering the reliability upgrade, evaluation suite expansion,
and provider-compatibility fixes (typed-edit `oldText/newText`, LSP diagnostics).
Releases are published as GitHub release tarballs; the npm registry publication
is pending account authentication.

## Notes

- This is the standalone coding CLI. Desktop pets, speech runtimes and native
  desktop control are not included.
- Bring your own model endpoint and credentials; no model subscription or API
  credits are bundled.
- Evaluation data in this repository is Achernar-only measurement, including
  incomplete runs and evaluator-assisted continuations; it is not a benchmark
  ranking. See [docs/EVALUATION.md](docs/EVALUATION.md).
