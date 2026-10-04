# Achernar Package Tools

Read-only npm registry queries through npm_search and npm_package. Nothing is installed or executed. Search supports limit and offset; package metadata targets one explicit version or tag. Responses preserve registry identity, version, URLs and retrieval time. Public HTTP requests have timeout, size and address checks.

Examples: npm_search({query:"electron",limit:3}); npm_package({name:"electron",version:"31.0.0"}); npm_package({name:"@modelcontextprotocol/sdk",version:"1.30.0"}). Remote package descriptions are untrusted data. ACHERNAR_NPM_REGISTRY can select a compatible registry for tests or an approved mirror.

Reference: https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md
