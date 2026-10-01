# Achernar Extensions

This directory contains the first-party Achernar extension catalog.

- `plugins/achernar/` contains eleven maintained integrations. Web Search,
  Project Tools, Runtime Checks, Git Tools, JSON Tools, and Package Tools expose
  local stdio MCP servers. Context7 connects to Upstash's official remote MCP;
  its service and documentation remain third-party resources. Computer Use,
  Memory, Appearance, and Desktop Pet document the capabilities already owned
  by the Electron runtime.
- `skills/achernar/` contains sixteen focused Skills with project-specific
  instructions. Their descriptions and validation rules are independent of
  any external host.
- `plugins/user/` and `skills/user/` are reserved for directories explicitly
  imported by the user. The catalog rebuild script never copies a remote
  marketplace or scans outside these buckets.

Run `node scripts/import-local-extensions.js` after adding a first-party or
user extension. It writes only `catalog.json` and records relative paths.

To enable the bundled MCP servers, open `插件与 Skills > MCP 列表`, choose
`从已导入插件读取`, review the entries, and enable the one needed for the
current task. The host expands `${pluginRoot}` and `${appRoot}` before starting
stdio servers. API credentials belong in Achernar's encrypted provider store,
never in this directory.

Validation commands:

```text
npm run test:extensions
npm run test:extensions-live
```

The live command requires network access. It performs public web search and
page reading (including Bing-to-360 fallback), Context7 library resolution and
documentation queries, npm metadata, WAV metadata and endpoint reachability;
it does not send a credential.

The four new entries are `achernar-context7`, `achernar-git-tools`,
`achernar-json-tools`, and `achernar-package-tools`. Import adds seven MCP
configurations in total and keeps them disabled until selected. Git Tools needs
Git on PATH and a repository under its configured `ACHERNAR_PROJECT_ROOT`.
Shared MCP registration helpers live in `extensions/lib/`; these plugins run
within the Achernar distribution and use its installed dependencies.
