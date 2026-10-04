---
name: achernar-mcp-development
description: Use when creating, integrating, testing, or reviewing an MCP server or plugin for Achernar.
---

# Achernar MCP Development

遵循 MCP 的初始化、工具发现、参数 schema、调用结果和关闭生命周期。工具描述要说明副作用、输入上限和失败方式；返回结构化 JSON 与可读错误。stdio 只把协议写到 stdout，诊断写 stderr。

插件清单必须包含有效的 `.codex-plugin/plugin.json`，路径相对插件根目录；MCP 配置可使用 `${pluginRoot}` 与 `${appRoot}`，由宿主展开。测试要实际启动进程，调用 `listTools` 和至少一个工具，并验证超时、取消、非法参数和路径越界。
