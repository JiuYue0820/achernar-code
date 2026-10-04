# Achernar Web Search

Achernar 自有的本地 stdio MCP 插件。它把真实联网检索和网页正文读取暴露为两个工具：

- `web_search`：通过 Bing RSS 与 360 搜索返回标题、原始目标 URL、摘要和检索时间。
- `fetch_webpage`：读取公开 HTTP(S) 页面，提取标题与正文，并限制重定向、响应大小和超时。

插件不需要搜索 API Key。默认搜索端点可通过 `ACHERNAR_SEARCH_ENDPOINT` 替换。公开 RSS 端点没有服务等级保证，因此错误会原样返回，调用方应保留可重试路径。

默认 `provider:auto`：Bing 原查询和短语重试无相关结果或失败后，自动使用 360。也可显式选择 `bing` 或 `360`。360 只提取自然结果中的 `data-mdurl` 目标地址，跳过 AI 生成答案、验证码页和不含原始目标的跳转链接；仍应用关键词与 site 过滤。备用端点变量为 `ACHERNAR_SEARCH_FALLBACK_ENDPOINT`。每次网络请求含重定向共限 12 秒，搜索最多三次请求，并支持调用取消。

搜索结果经过关键词匹配和 `site:` 域名检查。没有匹配结果时，自动移除通用英文问句词并以关键词短语重试一次；响应包含原始 `query`、实际 `effectiveQuery` 和 `attempts`。仍然无关或遇到验证页面时返回明确错误，不把错配内容交给 Agent。关键词检查只是初筛，结论仍需打开原文核实。部分英文查询在当前出口持续错配，可改用更短的查询或中文名称。主程序的 `web` 搜索使用同一个解析与重试模块。

2026-09-13 实网验收：MCP 文档、Electron 文档、小米 MiMo API 均检索到官方域名；MCP 官方文档正文读取成功。测试会检查官方域名，不能仅靠 HTTP 200 或 URL 数量通过。

本轮回归增加 `Achernar star`：Bing 错配后通过 360 返回 Space.com 和 arXiv 的相关结果。公开来源仍可能限流或改变结构；两者都失败时会报告每次尝试，不保证任意查询都有结果。

在 Achernar 的“插件与 Skills > MCP 列表”中选择“从已导入插件读取”，启用 `Achernar Web Search / web-search` 后即可调用。导入器会把 `${pluginRoot}` 展开成当前插件的绝对路径。

安全边界：只允许 HTTP(S)，拒绝 URL 内凭据、localhost、私网和保留地址；最多跟随四次重定向；搜索响应最多 2 MB，网页响应最多 3 MB。网页内容属于不可信外部数据，不能当成系统指令执行。

实现参考了公开资料：

- [Model Context Protocol: Build an MCP server](https://modelcontextprotocol.io/docs/develop/build-server)
- [Node.js Fetch API](https://nodejs.org/api/globals.html#fetch)
- [Bing search RSS endpoint](https://www.bing.com/search?format=rss&q=Model%20Context%20Protocol)
