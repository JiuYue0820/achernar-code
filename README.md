# Achernar Code

专注编程的 Node.js CLI 编码智能体:实时审批、可恢复会话、MCP 扩展与内置 Skills。与 [Achernar 桌面端](../Achernar-Desktop)共用模型适配、智能体循环与执行准则。

## 特性

- **终端 TUI**:`/` 指令菜单、多行编辑、鼠标交互、动画可关(`--no-animation` / `--plain` 兼容简单终端)
- **实时审批**:文件写入、终端命令、MCP 调用按策略逐项确认;`plan` / `review` 模式只读执行
- **上下文压缩**:台账 + 结构化摘要的分级压缩,工具输出主动剪枝,长任务保持在极小的上下文足迹
- **可恢复会话**:每步持久化,`resume <id>` 从中断处继续;检查点支持撤销
- **MCP 与 Skills**:stdio / HTTP MCP 服务器管理;按需读取的 Skill 指令包
- **自动诊断**:TypeScript / JSON 文件写入后即时校验(热 worker,常驻复用)
- **多模型**:OpenAI / Anthropic / Gemini 格式,推理模型规划、费用预算与故障转移

## 快速开始

需要 Node.js ≥ 22.22.2。一条命令全局安装,之后在任意项目目录输入 `achernar` 启动:

```powershell
npm install -g achernar-code
cd D:\Projects\YourProject
achernar            # 或 achernar --json doctor 检查环境
```

后续更新:`npm install -g achernar-code@latest`,或在 CLI 内输入 `/update` 检查并安装新版本。

从源码开发运行:

```powershell
npm ci
npm link
achernar
```

也可以不经安装直接在项目源码内运行:`node cli/index.js`。配置模型后即可对话(`/model add` 添加模型);`/settings` 是模型、执行限制、预算、扩展与语言的分组入口。

## 开发

```powershell
npm test              # 全部测试(node --test tests/*.test.js)
npm run test:cli-core # CLI 核心子集
npm run lint          # eslint
npm run format:check  # prettier
```

架构速览:

| 目录 | 内容 |
| --- | --- |
| `cli/` | 终端交互、会话持久化、命令路由(`index.js` 为入口) |
| `src/services/` | 智能体循环、工具实现、审批策略、MCP、诊断(与桌面端共享) |
| `extensions/` | 官方 Skills 与插件目录 |
| `docs/` | 升级与验证记录 |

`agent-core.js` 的上下文压缩采用四道防线:未超限时的旧工具输出主动剪枝(60% 阈值)、确定性任务台账(精确路径 / 命令 / 失败,不依赖模型复述)、TASK/DONE/NOW/DATA 结构化摘要(≤200 词)、逐级退役与截断,压缩目标为窗口的 40%。

## 许可

MIT,详见 [LICENSE](LICENSE);第三方组件清单见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
