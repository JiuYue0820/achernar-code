---
name: achernar-debugging
description: Use when an Achernar behavior fails, flakes, hangs, or differs between source and packaged runtime.
---

# Achernar Debugging

先稳定复现并记录环境、输入、预期和实际结果。沿错误边界收集最小日志，优先检查最近改动、异步取消、路径解析、缓存和持久化。不要通过吞掉异常或放宽校验来掩盖问题。

写一个能在修复前失败的回归测试，确认失败原因正确，再修复根因。验证正常、错误、取消和重启路径，并清理临时数据。报告仍无法复现的条件与证据。
