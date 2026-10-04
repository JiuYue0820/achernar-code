---
name: achernar-architecture
description: Use when designing or documenting boundaries between Achernar's main process, renderer, services, providers, memory, and extensions.
---

# Achernar Architecture

先写边界：谁拥有状态、谁能访问文件或网络、谁负责取消和错误翻译。主进程持有凭据和原生能力，渲染器只通过受限 IPC 使用它们；扩展通过声明式资源和明确的 MCP 进程接入。

为跨边界数据定义版本、大小上限、敏感字段处理和兼容迁移。同步流程画出顺序，异步流程标出取消点和生命周期。设计应能用隔离测试验证，不依赖隐藏全局状态。
