# Achernar Code — Usage Guide

A complete command and shortcut reference for the standalone coding CLI.
For the short tour, see [README.md](README.md).

## Install

Requires **Node.js 22.22.2+** and npm.

```powershell
npm install -g https://github.com/JiuYue0820/achernar-code/releases/download/v0.2.0-rc.8/achernar-code-0.2.0-rc.8.tgz
achernar --version
```

Or install the tagged source with Git:

```powershell
npm install -g github:JiuYue0820/achernar-code#v0.2.0-rc.8
```

## Start

Run inside the project you want to work on:

```powershell
cd D:\Projects\YourProject
achernar
```

Type `/` to open the command menu, or press **Ctrl+P** to search commands.

## Slash commands

| Command | Purpose |
| --- | --- |
| `/model add` / `/model import` | Configure or import a provider (base URL, API key, model ID, protocol) |
| `/model` | Manage saved model profiles (Ctrl+E edit, Delete remove, Ctrl+E reasoning level) |
| `/reasoning` | Select or customize per-model reasoning levels |
| `/session` | Resume saved conversations; Delete removes the selected record (project files are kept, running sessions are locked) |
| `/settings` | Model, runtime, budget and integration controls |
| `/skills` / `/plugins` / `/mcp` | Manage bundled and imported extensions |
| `/shell` / `/sandbox` | Choose command shell and execution sandbox (host / restricted / Windows Job / Docker) |
| `/files` / `/search` / `/git` / `/diff` / `/output` | Local viewers, no model calls; Escape returns to the draft |
| `/commands` | Open the command search (also **Ctrl+P**) |
| `/language` | Switch interface language |
| `/update` | Check official releases and control update notifications |
| `/shortcuts` | Show and configure key bindings |

Headless / scripting entry points:

```powershell
achernar run --task-file task.md
achernar run --stdin
achernar run --plan "Inspect this project and propose a small change"
achernar --stream-json run --approval code "Fix the parsing error and run the relevant tests"
achernar --json doctor
```

## Key bindings

| Key | Action |
| --- | --- |
| **F2** | Change approval policy while a task runs: Strict, Code or Auto |
| **Shift+Tab** | Change execution mode: Code, Plan or Review (Plan/Review enforce read-only tools) |
| **Ctrl+O** | Toggle tool details |
| **Ctrl+T** | Toggle model-provided thinking text |
| **Ctrl+P** | Search commands / open command menu |
| **Ctrl+C** | Copy the frozen selection while a task runs |
| **Esc** | Return from a viewer / resume the live view / resume after a copy |

- Type another instruction while a task is running to queue a correction at the next model/tool boundary.
- Drag to select text; click a gray user message to copy or rewind.

## Execution modes

- **Code** — full read/edit/write tools.
- **Plan** — read-only; produces a plan without applying edits.
- **Review** — read-only; audits existing code.

## Approval policies

- **Strict** — every tool execution needs explicit approval.
- **Code** — auto-approves coding tools, gates destructive ones.
- **Auto** — proceeds without prompts (use with care).

## Output formats

- **JSON** and **JSONL** output for scripts via `--json` / `--stream-json`.
- Bounded task rounds and recoverable failure records for long runs.

## Extensions

- 13 bundled coding Skills and 7 CLI-compatible official Plugins.
- `achernar extensions pack/import` shares hashed Skill/plugin bundles; imported MCP remains disabled until enabled.
- Built-in JS/TS LSP: symbols, definitions, references, hover and compiler diagnostics.

## Sandbox notes

- Default host execution uses your own permissions.
- Opt-in Docker isolates terminal commands only; native files, model requests and web reads are outside that boundary. MCP and LSP are disabled during Docker tasks.
- Restricted/Job modes retain host MCP/LSP and do not isolate filesystem or network access.

See [docs/CODE_INTELLIGENCE.md](docs/CODE_INTELLIGENCE.md) and [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for details.
