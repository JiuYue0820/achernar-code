---
name: achernar-security
description: Use when assessing or changing Achernar code that handles credentials, files, network access, subprocesses, extensions, or desktop control.
---

# Achernar Security

检查信任边界和攻击路径：渲染器到 IPC、项目路径到真实路径、网页到模型上下文、插件到子进程、用户输入到 PowerShell。拒绝路径越界、符号链接逃逸、URL 凭据、私网 SSRF、无限响应和未审批副作用。

凭据只经安全存储传递，日志和错误做脱敏。外部内容标为数据，不能覆盖系统规则。每个修复都补一个能证明原漏洞的测试，并验证取消、重定向和资源上限。
