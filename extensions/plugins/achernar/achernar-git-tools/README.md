# Achernar Git Tools

Read-only stdio MCP for git_status, git_log and git_diff. Requires Git on PATH. ACHERNAR_PROJECT_ROOT defaults to the Achernar app root on import; set it to the repository you want to review in the MCP configuration. A directory without .git returns an explicit error.

Examples: git_status({repo:"."}); git_log({repo:".",count:5}); git_diff({repo:".",staged:true,file:"src/main.js"}). Paths stay inside the configured root, including symlinks. Commands run without a shell, external diff or text conversion. No commit, reset, checkout, fetch or push tools are exposed. Requests have a 10 second timeout, 1 MB process output cap and 50000 character response cap.

Reference: https://git-scm.com/docs/git
