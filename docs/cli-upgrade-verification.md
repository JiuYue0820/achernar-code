# Achernar CLI 改进清单与本地验证

本轮按新的 P0/P1/P2 清单实现并接入 CLI。原有未提交的桌面/UI 修改已保留，当前分支为 `codex/cli-reliability-upgrade`。没有推送、发布或覆盖用户模型配置。

2026-09-27 的后续检查与修复见 `docs/cli-followup-verification.md`。下文保留上一轮结果与两轮真实模型测量，未用后续测试覆盖历史数据。

## 逐项对照

| 优先级 | 项目 | 结果 |
| --- | --- | --- |
| P0 | regex / include / exclude / glob 搜索 | 已验证，支持 `*.{ts,tsx}`、排除规则和正则 Worker 超时 |
| P0 | unified diff 审批 | 已验证，修改前预览，拒绝不写入，审批期间文件改变会拒绝覆盖 |
| P0 | 编辑后自动 diagnostics | 已验证，JS/TS LSP 与 JSON 诊断进入下一轮；不支持的语言明确标注 |
| P0 | 迭代压缩 | 已实现，摘要失败降级，逐步裁剪旧结果，必要时成组移除已完成调用；保护当前要求和拒绝记录 |
| P0 | CI | 已配置推送/PR 的核心、TUI、fixture eval 和独立包安装检查；远程 Actions 尚未运行 |
| P0 | JSON 英文系统字段 | 已接入并测试，用户/模型内容和源代码保持原语言 |
| P1 | 原生 Git | 已实现 status/diff/log/stage；字面路径、防参数注入、结构化输出；暂存仍经审批 |
| P1 | 费用上限 | 已实现 USD 费率、任务共享预留、`--max-cost`、费用显示；摘要/子代理计入 |
| P1 | 沙箱中间档 | 已实现 `restricted` 写白名单，检查真实链接目标，保留 MCP/LSP |
| P1 | 工具结果缓存 | 已验证同字节/范围只返回 revision，避免重复正文；`fresh:true` 可重取 |
| P1 | 废操作抑制 | 系统规则与执行层阻止单独的 `exit 0`、`true`、`echo done` 等 |
| P1 | 会话级 undo | 已实现 `/undo`、`/redo` 和无交互命令；文件与对话共同恢复 |
| P2 | 故障转移 | 已实现配置模型链；4xx/5xx、网络故障在未输出时转移，部分流不重播 |
| P2 | Hooks | 已实现显式导入的 tool_pre/tool_post，超时、取消、拒绝与环境脱敏 |
| P2 | 真实模型 eval | 已实现固定三任务与独立验收、指纹和阈值；真实运行记录含失败 |
| P2 | 一键包验证 | 已通过 ZIP → 独立解压 → 安装 → npm pack → 第二次安装 → 执行验证 |
| P2 | TUI 语言 | 主要控件和通知支持英/中/日/韩/西，默认随系统；未翻译技术文字回退英文 |
| P2 | 会话导出 | 已实现版本化脱敏 JSON，不修改原会话、不覆盖既有文件 |

没有新增消息网关、cron、云后端、PPT 引擎或自我学习闭环。

## 本地测试结果

环境：Windows，Node.js `v24.15.0`。以下数字来自本轮实际执行。

| 检查 | 结果 |
| --- | --- |
| `npm run test:all` | 225 项：222 通过，3 跳过，0 失败 |
| `npm run test:cli-core` | 58 项：57 通过，Docker 运行检查 1 项跳过 |
| `npm run test:cli-tui` | 50/50 通过 |
| 独立分发包测试 | 104 项：103 通过，Docker 运行检查 1 项跳过 |
| ZIP/npm 安装后检查 | 通过：真实文件写入、模板、命令、MCP、LSP、审批拒绝、恢复、撤销/恢复、脱敏导出、英文机器状态 |
| 固定协议 fixture | 3/3；只用于工程回归，不计入真实模型质量 |
| `git diff --check` | 通过 |

全量测试的三个跳过项为两项原生 ASR 和一项 Docker 实机测试；没有把跳过计为通过。包中保留 13 个官方 Skills 和 7 个官方 Plugins，不包含 CLI 桌面操控。

验证日志：`output/cli-upgrade-all-final.log`、`output/cli-upgrade-core.log`、`output/cli-upgrade-tui.log`、`output/cli-upgrade-package.log`。

## 真实模型结果

模型 **`agnes-3.0-flash`**，服务地址 `https://apihub.agnes-ai.com/v1`，OpenAI 兼容 Chat Completions。每项最多 12 轮、120 秒，自动审批，合成测试项目，无子代理。

| 任务 | 第一轮 | 第二轮 |
| --- | --- | --- |
| clamp 边界修复 | 通过；24.002 秒，17,453 Token | 通过；13.339 秒，21,844 Token |
| regex/glob 过滤与产物 | 通过；10.108 秒，12,605 Token | 通过；14.350 秒，17,235 Token |
| 类型修复与自动诊断 | 通过；6.442 秒，12,324 Token | 未完成；7.709 秒，读取后遭遇 HTTP 429，重试仍失败 |

两轮分别 **3/3、2/3**，共 5/6 次任务完成。第二轮的阈值检查正确返回失败。没有把限流失败删除或改记成功，也没有把小样本当作综合排名。未配置已确认单价，因此真实费用为 unknown；第二轮失败项的汇总 Token 未取得。

详细记录位于 `cli/publish/docs/EVALUATION.md` 和 `cli/publish/docs/evaluation/reliability-agnes-r1.json`、`reliability-agnes-r2.json`，包含实际源码指纹和 UTC 时间。它们对应测量时的源码，随后仅澄清了限流错误提示。

原始测试产物保存在：

```text
D:\User\Desktop\Project\Test-CLI\reliability-20260926-agnes-r1
D:\User\Desktop\Project\Test-CLI\reliability-20260926-agnes-r2
```

## 使用入口与边界

`/pricing`、`/budget`、`/fallbacks`、`/hooks`、`/undo`、`/redo`、`/export`、`/language` 已加入 `/` 菜单。完整配置示例见 `cli/README.md`。

- `restricted` 约束内置文件写入，shell/MCP/Hooks 仍有宿主权限；不是 Windows OS 沙箱。
- `--max-cost` 控制客户端后续请求，费率由用户配置；服务商实际账单可能不同。切模型不复用旧费率。
- 相同文件仍从磁盘读取以校验指纹；缓存节约模型输入，不宣称节约磁盘 IO。
- 快照默认 256 MB / 20,000 条目，冲突、超限或外部 Git 索引会明确禁用撤销。项目外部的副作用不在回滚范围内。
- 不可压缩的单条超大用户请求/系统规则仍会返回容量错误；不会发送明知装不下的请求。
- 导出扫描常见敏感模式，不能保证识别自然语言中的全部隐私，分享前需查看。
- 远程 CI 未触发；本机 Docker 实机隔离未验证。真实模型稳定性仍受服务商限流影响。

GitHub 的真实 eval 可手动运行；配置 `ACHERNAR_EVAL_API_KEY` secret、`ACHERNAR_EVAL_BASE_URL` / `ACHERNAR_EVAL_MODEL` 变量后，可用 `ACHERNAR_EVAL_ENABLED=true` 在可信推送自动执行。PR fixture 不使用模型凭据。
