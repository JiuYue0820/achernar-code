# IDE tasks and extension distribution

## VS Code

Install `achernar` on PATH, then run `achernar ide` inside a project to preview
three process tasks: interactive chat, read-only review and project inspection.
`achernar ide --write` merges missing tasks into `.vscode/tasks.json`. Existing
labels are preserved and subsequent runs are idempotent. Files containing JSON
comments are left untouched; merge the displayed preview manually.

Use **Terminal → Run Task → Achernar: chat**. The launch root is `${workspaceFolder}`.
This is integrated-terminal task support, not a VS Code marketplace extension.

## Share Skills and plugins

```sh
achernar extensions pack ./my-skill --kind skills --out my-skill.achernar.json
achernar extensions pack ./my-plugin --kind plugins --out my-plugin.achernar.json
achernar extensions import ./my-plugin.achernar.json
```

A Skill needs `SKILL.md`; a plugin needs `README.md`. Plugin `.mcp.json` uses the
existing `mcpServers` format and may reference `${pluginRoot}` and `${env:NAME}`.
Distribute the bundle as a GitHub Release asset, alongside source, a license chosen
by its author, version notes and provenance. No automatic remote fetch or execution
occurs during import.

Bundles contain per-file SHA-256 checksums; import validates paths, hashes and
size limits before writing. Hashes detect corruption, **not publisher identity**:
review third-party source before enabling an imported MCP server in `/mcp`.
Secret-looking filenames are rejected when packing; authors remain responsible
for checking the contents of every included file. Limits: 1,000 files and 5 MB of
decoded content. Symlinks, `.git` and `node_modules` are not packed.

CLI-compatible official extensions remain protected. Desktop control, pet,
appearance, voice and desktop-specific document/memory resources are excluded
from the CLI catalog; the desktop application's catalog is unchanged.

There is currently no hosted marketplace, signed registry, or claimed third-party
community. Local folder imports and MCP JSON imports continue to work.
