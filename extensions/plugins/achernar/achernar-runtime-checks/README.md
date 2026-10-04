# Achernar Runtime Checks

Achernar 自有的只读诊断 MCP 插件，面向当前语音和模型栈：

- `runtime_environment`：报告插件进程的 Node.js、平台和架构。
- `inspect_model_directory`：有界枚举本地模型目录，不读取模型权重内容。
- `inspect_wav`：解析 RIFF/WAVE 的声道、采样率、位深、数据大小和时长。
- `probe_openai_endpoint`：不携带凭据访问 OpenAI 兼容服务的 `/models`，区分网络不可达与需要认证。

`probe_openai_endpoint` 故意不接受 API Key，避免密钥进入工具参数、日志或会话记录。`401` / `403` 会报告为“服务可达且需要认证”。网络探测拒绝 localhost、私网和 URL 内凭据。

当前 Achernar 配置可用它检查 Agnes 的 `https://apihub.agnes-ai.com/v1` 与 MiMo 的 `https://api.xiaomimimo.com/v1`。真实推理仍应通过应用的加密凭据存储执行。
