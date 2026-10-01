---
name: achernar-coding
description: Implement or debug code in an existing project, using bounded context and observable verification; also guides use of Achernar Code CLI.
---

Read relevant AGENTS.md, package/build configuration and affected source. Use files.search to locate a symbol and files.read with startLine/endLine for long files. A file map is partial; missing entries do not prove a file is absent. Preserve unrelated work.

For multiple dependent steps publish a short plan. Reproduce the reported failure when practical, then make a focused edit with files.edit/write. Select tests/builds relevant to the changed behavior; inspect exit codes and failure output. Refine the cause after an error instead of repeatedly running the same failing command. Report changed paths, actual verification, and outstanding blockers separately.

Honor the requested filenames, exports and delivery location. A successful test command with zero discovered tests is not test coverage. Once the requested behavior and meaningful checks pass, finish; add more checks only for an unresolved concern. For substantial new frontend work, read achernar-ui-design and select its official template when suitable; adapt within the existing framework rather than replacing the project structure.

Use read-only /plan for proposals and /review for bug findings with path/line evidence. A review is not permission to apply changes. Shell execution belongs to execute mode and follows the host approval decision.

When the user requests the terminal workflow, verify `achernar --help`, then `achernar --json doctor`. Set provider endpoint/model in `achernar config set`; use environment variables for credentials. Discover via `achernar skills`, `achernar inspect`, `achernar search`; use exact session/skill IDs returned by these commands. `tool-call` is read-only, not a way around approvals.

```powershell
achernar --json doctor
achernar run --plan "Investigate the failing login flow"
achernar run "Fix the confirmed login bug and run relevant tests"
```

Use `achernar sessions` and `achernar resume <id>` to continue. Installation/download instructions are in the app's CLI panel. Do not enable `--approval auto` or publish/delete remote resources without user authorization.
