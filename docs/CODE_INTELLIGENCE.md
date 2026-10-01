# Code intelligence and execution

## Read code semantically

The CLI includes `typescript-language-server` 6.0.1 and TypeScript 5.9.3. It starts
the language server on demand, pins the shipped tsserver rather than a project's
executable, disables automatic type downloads, and does not configure plugins.
The server can still read imports, referenced projects and tsconfig paths on the
host. Returned source locations are restricted to the admitted root. This is a
read-only tool interface, not OS read isolation.

```sh
achernar code status
achernar -C ./project --json code symbols src/index.ts
achernar -C ./project --json code definition src/index.ts --line 12 --column 9
achernar -C ./project --json code references src/index.ts --line 12 --column 9
achernar -C ./project --json code hover src/index.ts --line 12 --column 9
achernar -C ./project --json code diagnostics src/index.ts
```

Positions use 1-based lines and UTF-16 columns. Symbol/location lists return at most
40 entries by default (the agent tool accepts a limit up to 100). Diagnostics are
per-file syntactic and semantic compiler results, not an entire-project build or
lint pass. Use the project's normal checks before declaring a change verified.
JS, TS, JSX and TSX are supported; other languages use text search and project tools.
Strict approval asks before LSP queries; Code approval permits these reads.
Plan/Review allow the five read-only actions.

## Choose command execution

```sh
achernar environment --set-shell auto
achernar --shell bash run "Run the project's existing tests"
achernar --json doctor
```

`/shell` and `/sandbox` configure subsequent tasks from the TUI and persist the
selection. `--shell` and `--sandbox` override the stored selection for a launch.
Automatic approvals never imply isolation.

```sh
docker pull node:24-bookworm-slim
achernar environment --set-sandbox docker
achernar --json doctor
achernar --sandbox docker --shell auto run "Run the installed project tests"
achernar environment --set-sandbox off
```

Docker must run Linux containers. Pull the image yourself; `--sandbox-image` can
select another locally available Linux image with your build tools. Consider
pinning its digest for reproducibility. The built-in Node image does not include
every compiler. `auto` selects sh inside the container.

Each command gets a fresh container and only its admitted project bind mount at
`/workspace`. Network is disabled, the root filesystem is read-only, capabilities
are dropped, privilege escalation is disabled, temporary storage is bounded, and
CPU/memory/process limits apply. On POSIX, the host UID/GID is used. Cancellation
removes the owned container; failure to confirm cleanup is reported.

**Boundary:** this isolates terminal processes, not the entire agent. The mount
is writable and includes all files already inside that project. Native file tools
still edit admitted host paths. Model requests and web reads use host networking.
Host MCP and LSP execution are disabled during Docker tasks to avoid a second
unisolated subprocess route. Native host execution remains available only when
the user explicitly chooses `off`; a missing daemon/image never triggers fallback.

No Docker service or image is installed or started automatically by the CLI.
