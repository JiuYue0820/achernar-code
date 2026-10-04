---
name: achernar-voice-stack
description: Use when configuring or validating Achernar's local ASR, OpenAI-compatible LLM, or voice-clone TTS providers.
---

# Achernar Voice Stack

ASR 先检查本地模型目录和实际运行时兼容性，再进行短 WAV 推理；目录存在不等于模型可用。LLM 使用规范化的 base URL、模型名和加密凭据，先做无密钥可达性检查，再做最小请求。TTS 参考音频必须带正确 MIME 前缀，克隆能力和语言由服务响应确认。

不要把密钥写入配置清单、日志、测试快照或 MCP 参数。所有请求设置超时、取消和响应大小上限，并记录 provider、模型、状态码和耗时而不记录凭据。详细检查表见 [references/provider-checks.md](references/provider-checks.md)。
