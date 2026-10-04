---
name: achernar-implementation
description: Use when turning an approved Achernar requirement into a focused code change with existing patterns and explicit acceptance checks.
---

# Achernar Implementation

把需求拆成可观察行为、数据契约和失败路径。复用现有服务、IPC、存储和 UI 模式；只有能减少真实复杂度时才新增抽象。保持改动在相关模块内，避免顺手重构无关代码。

先写能证明行为的测试并观察其失败，再实现最小改动；对配置或生成文件也运行对应的解析器。完成后检查取消、超时、空输入、重启恢复和权限边界。每项验收标准都要有命令或运行步骤。

不要把密钥、个人路径或临时调试输出写入源代码、清单、截图和日志。
