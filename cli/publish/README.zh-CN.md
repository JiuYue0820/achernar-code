# Achernar Code

本地可靠性升级已加入原生 Git、任务费用上限、备用模型、用户 Hooks、任务撤销/恢复、脱敏导出和跟随系统的主要界面语言。写路径白名单模式保留 MCP/LSP，但不等同于系统沙箱。配置与边界见 [可靠性清单](docs/RELIABILITY.md)。

新增固定任务评测使用 **`agnes-3.0-flash`**，服务地址为 `https://apihub.agnes-ai.com/v1`。两轮结果为 **3/3、2/3**，后一轮保留了一次 HTTP 429 限流导致的未完成；不是综合能力排名。数据和每项耗时、Token 见 [评测报告](docs/EVALUATION.md)。可运行 `achernar eval --live --out <新目录>` 复测自己的模型，会产生服务商用量。

2026-09-27 新增五任务双模型矩阵：同一端点的 `agnes-3.0-flash`、`agnes-2.5-flash`。两轮各为 **2/10**，第一轮有 7 次 HTTP 429 和 1 次编辑参数兼容失败，第二轮有 8 次 HTTP 429；修复后，`agnes-2.5-flash` 的单独类型编辑复测 **1/1 通过**。原失败记录保留，不用定点成功替换整套结果。

支持实时审批、会话恢复、MCP 和官方 Skills 的终端编程 Agent。

[English](README.md) · [详细用法](USAGE.md) · [自身评测数据](docs/EVALUATION.md)

当前为 **0.2.0-rc.8 CLI 预览版**，桌面应用继续测试，不包含在发布物中。需要自行配置模型服务商和 API 凭据，不附赠模型订阅或额度。通过下方 GitHub 版本化发行包安装；npm 注册表发布仍待维护者完成发布验证。

本候选版加入运行设置、请求重试、命令/任务时限、正则与通配符搜索、可滚动 diff 审批及编辑后自动诊断。已实现范围与待办见[可靠性进度](docs/RELIABILITY.md)。

rc.8 让系统提示词在多轮之间保持不变，使服务商的提示缓存可以命中；单次请求时限改为按无响应时间计算；任务超时会返回可恢复的会话 ID。详见[版本说明](RELEASE_NOTES.md)。

## 安装

安装 Node.js 22.22.2 或更新版本后，在 CMD / PowerShell 执行：

```powershell
npm install -g https://github.com/JiuYue0820/achernar-code/releases/download/v0.2.0-rc.8/achernar-code-0.2.0-rc.8.tgz
achernar
```

这是通过 npm 安装 GitHub 发行包。npm registry 的按包名安装仍待账号登录和正式上传完成，不应把 `npm install -g achernar-code@next` 当作已经可用。

在你需要操作的项目目录启动 `achernar`，输入 `/model add` 配置模型，输入 `/` 展开命令。

## 核心功能

- 执行过程中用 F2 实时调整审批，Shift+Tab 切换 Code / Plan / Review。
- 可以继续输入补充要求；思考、调用、控制台记录可展开或收起。
- `/session` 恢复或删除会话；目录访问和审批分别控制。
- 包含 13 个官方编程 Skills、7 个 CLI 适用的官方 Plugins，以及 3 套可供工具复制和改造的原创 UI 模板。
- 支持模型导入和 MCP / Skills / Plugins 管理，提供 JSON / JSONL 自动化输出。
- 工具层执行只读限制和审批判断，任务失败后保留恢复记录。
- Ctrl+P 或 `/commands` 搜索命令，`/settings` 集中管理模型、预算、运行和扩展配置。
- `/files`、`/search`、`/git`、`/diff` 提供无模型调用的本地查看窗口；代码保留缩进和语法颜色，关闭弹窗后回到原草稿。
- `run --task-file task.md`、`run --stdin` 接收多行代码任务；Windows Job 模式限制终端进程数、内存并清理子进程，MCP/LSP 仍可用。
- `/reasoning` 选择推理强度，支持自定义显示名称与实际 API 值，并随模型配置保存；模型列表支持 Ctrl+E 编辑、Delete 删除。
- 拖选文本时冻结画面，后台任务继续；Ctrl+C 复制，Esc 返回实时显示。点击用户灰色消息可复制或撤回，`/shortcuts` 修改快捷键。
- `/language` 切换语言，`/update` 检查更新并设置提醒。安装版启动时检查官方 npm 包，有新版本会提示，经确认后安装并重启。

本次只准备 CLI 发布。发布流程加入版本检查、三个系统上的测试、安装包验收和 npm 可信发布；实际远端运行和上传仍需账号登录。桌面端保留测试状态。详见[更新路径](docs/UPDATES.md)和[工程结构](docs/ENGINEERING.md)。

## 评测说明

2026-09-27 本轮使用 `https://api.deepseek.com` 的 **`deepseek-flash`（low）** 与 **`deepseek-v4-pro`（high）**，分别通过固定编程任务 **5/5**；另测 `none` 与自定义 `max`，各通过一次类型编辑任务。新 OpenCode Zen 凭据校验返回 HTTP 401，没有成功的新评测记录。逐项耗时、Token、推理强度、估算费用均已保留。

公开数据只包含 Achernar 自身，不设竞品对照或排行榜。修复任务记录为 77.769 秒、13 次工具调用、11 项测试；CSV 任务连续两轮超时仍未完整收尾；UI 任务在辅助续跑后才补齐 README。

**真实任务测试模型：`space-bunny-free`，通过 OpenCode Zen 的 OpenAI 兼容接口调用，测试日期为 2026-09-26。** 安装、权限等功能验收使用独立的本地确定性夹具，不计作模型能力评测。

完整耗时、Token、产物验收和限制见 [评测文档](docs/EVALUATION.md)。未报告的 Token 标记为缺失，不按零计算；产物通过检查也不等于整轮任务已完成。

## 当前边界

这是独立 CLI，不含桌面宠物、语音运行时和桌面原生控制。自动审批下的终端仍具有当前用户权限，不是操作系统沙箱。第三方模型和 MCP 服务需要各自的配置，长任务仍可能需要续跑。

Achernar 自身代码以 [MIT 许可证](LICENSE) 发布。第三方资源的原有许可说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

欢迎通过 Issues 提交可复现问题，附操作系统、Node 版本、接口格式和已脱敏的步骤；不要上传密钥或私有项目内容。
