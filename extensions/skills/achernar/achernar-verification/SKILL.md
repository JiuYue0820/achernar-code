---
name: achernar-verification
description: Use when validating a completed Achernar change across unit tests, extension manifests, MCP protocol, UI smoke, or runtime boundaries.
---

# Achernar Verification

先运行与改动直接相关的测试，再运行项目要求的回归集。扩展验证包括清单 schema、路径存在、来源归属、Skills frontmatter、MCP 进程启动、工具发现和真实调用。网络功能必须返回有效 HTTP(S) URL 或明确的可诊断错误。

UI 改动要在最小和宽窗口检查计算几何与截图；provider 改动要隔离凭据并记录状态码。报告通过、跳过和未验证项，不能把静态检查写成真实运行成功。
