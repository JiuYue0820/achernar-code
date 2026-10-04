---
name: achernar-codebase-inspection
description: Use when an Achernar task requires understanding an unfamiliar repository, module boundary, runtime entrypoint, or existing behavior before editing.
---

# Achernar Codebase Inspection

先盘点根目录、包清单、测试入口和当前改动，再沿调用链读取最少但足够的文件。优先 `rg --files` 与 `rg`，记录入口、数据流、权限边界和可复现的验证命令。

区分源代码、生成物、用户数据和第三方缓存。动态构建的 DOM、IPC 和配置迁移必须同时检查静态定义与运行时构造。不要因为文件名相似就假设两个实现等价；用测试或调用方确认契约。

输出短的结构图和风险清单，指出哪些结论来自当前代码、哪些仍需运行验证。修改前保存基线测试结果。
