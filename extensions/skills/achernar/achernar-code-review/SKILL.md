---
name: achernar-code-review
description: Use when reviewing an Achernar diff for bugs, regressions, security issues, or missing verification.
---

# Achernar Code Review

先找会导致错误行为、数据丢失、越权、密钥泄露、挂起或兼容性回退的问题，再看可维护性。每个发现都给出文件、行号、触发条件、影响和修复方向；没有证据的偏好不要写成问题。

特别检查 IPC 参数校验、项目路径边界、外部网页不可信性、子进程继承环境、流式协议、资源上限和取消清理。确认测试覆盖真实契约，而不是只断言实现细节。最后列出未验证的运行环境。
