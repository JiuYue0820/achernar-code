---
name: achernar-memory
description: Use when deciding what Achernar should remember, retrieve, update, or compress across sessions.
---

# Achernar Memory

写入前读取对应范围，保留仍然有效的事实并删除过时冲突。只保存稳定偏好、已确认约束、项目决策和可复用背景；不保存 API Key、令牌、完整附件、临时错误或未经确认的推断。

选择最窄的范围：session 只服务当前任务，recent 服务近期工作，global 服务长期偏好，character 服务角色设定。压缩必须保持事实、来源和不确定性；写回前检查原文没有被并发修改。
