# CLI 工作台升级与验证

日期：2026-09-27。延续当前工作区修改，保留桌面端已有改动；候选版本为 `0.2.0-rc.4`。本轮没有提交、推送或发布。

## 功能入口核对

| 能力 | 交互入口 | 无交互入口 / 边界 |
| --- | --- | --- |
| 命令发现 | Ctrl+P、`/commands`；名称匹配优先于说明文字 | `achernar --help` |
| 配置 | `/settings` 分组进入模型、执行、预算、扩展与语言 | `settings`、`config`、`pricing`、`budget` 等已有命令 |
| 项目代码 | `/files [路径]`，有行号、语法颜色和滚动 | 本地只读预览前 128 KiB，超限标注；不请求模型 |
| 搜索 | `/search` 交互选择字面/正则及 include/exclude | `search` 的 regex/glob 参数 |
| Git | `/git`、`/diff` 查看状态、工作区、暂存区和提交 | 原生结构化 Git 工具；查看不会修改文件 |
| 诊断和用量 | `/doctor`、`/cost`、`/output` | `--json doctor`；probe 才额外请求模型列表 |
| 执行控制 | `/agents`、`/output-limit`、审批/模式实时控制 | 对应已有启动参数；审批仍在每次执行前读取 |
| 多行代码输入 | 宽字符上下移动、跳词、词删除；弹窗保留草稿与光标 | `run --task-file`、`run --stdin`，UTF-8 文件和管道输入上限 200000 字节 |
| 文件编辑 | diff 审批；`oldText + content` 或 `oldText + newText` | 同一写入/自动诊断流程；参数冲突、拒绝或过期预览不写入 |
| Windows 进程限制 | `/sandbox` 选择 Job | `--sandbox job --job-memory-mb 1024 --job-processes 32` |
| 多模型评测 | 命令行评测 | `eval --live --models model-a,model-b --out <新目录>` |

输入输出仍沿用现有 CLI 风格，代码保留缩进，思考和调用可折叠。源文件预览是只读窗口，不是内置编辑器。Job 模式验证了活动进程上限和退出时子进程清理，加入 Job 失败不会回退到无限制运行；它不隔离文件系统/网络，MCP/LSP 仍在宿主运行。

## 本轮实际发现并修复

1. `agnes-2.5-flash` 使用 `oldText/newText` 时参数校验失败。已兼容，并验证差异审批、自动 LSP 诊断、空替换、字面 `$` 字符、拒绝和过期预览。
2. 非法工具参数原本只有笼统消息，现带字段详情及稳定的 `INVALID_TOOL_ARGUMENTS` 错误码；原有只依赖中文报错的两项测试改为验证该错误码。
3. `cli/task-input.js` 漏入独立包，源码工作目录中可用、安装后会失败。已补齐并增加归档资源检查；安装后实际验证 task-file/stdin 到模型协议的多行、中文内容。
4. 命令搜索 `files` 原先把说明中包含 files 的 `/plan` 放在 `/files` 前。现在精确名称、名称前缀、名称包含、说明包含依次排序。
5. 原 CI 真实模型评测可选，独立发布工作流缺少对应任务。两处现有 `Live coding regression` job 在默认分支 push 和选中的手动 dispatch 运行；缺失配置失败，不退化为 fixture。

## 工程验证

| 检查 | 结果 |
| --- | --- |
| `npm run test:all` | 253 项：250 通过、3 跳过、0 失败 |
| `npm run test:cli-tui` | 58/58 通过 |
| `npm run test:cli-core` | 78 项：77 通过、1 Docker 实机检查跳过 |
| `npm run test:cli-package` | 独立目录 131 项：130 通过、1 Docker 实机检查跳过；随后 npm 打包、再次独立安装和 13 组实际运行检查通过 |
| `eval --fixture` | 五个任务均通过，仅为协议与验收链路验证 |
| CLI cell-grid 预览 | 查看了常规代码窗口、40 列窄窗口和命令面板；非原生终端截图 |
| 两份 CI YAML | 本地解析通过；PR 不走带模型密钥的任务 |
| `git diff --check` | 无空白错误；已有文件 LF/CRLF 提示仍保留 |

全量跳过项是两项原有 ASR 环境测试和一项 Docker 实机测试。以上套件有重复，不应累加为独立测试总数。日志位于 `output/cli-workbench-{all,tui,core,package,fixture}.log`，预览位于 `output/playwright/cli-workbench-*.png` 和 `cli-command-palette.png`。相关修复测试记录了先失败再通过；已有实现由本轮复核验证。

## 真实模型测量

模型：**`agnes-3.0-flash`、`agnes-2.5-flash`**；端点：`https://apihub.agnes-ai.com/v1`；Windows / Node 24.15.0。

| 测量 | 通过 | 未通过原因 |
| --- | --- | --- |
| 第一轮双模型五任务矩阵 | 2/10 | 7 次 HTTP 429，1 次编辑流程验收失败 |
| 修复后第二轮完整矩阵 | 2/10 | 8 次 HTTP 429 |
| 单独复测 `agnes-2.5-flash` 的 typed-edit | 1/1 | 无；再次使用 `oldText/newText`，写入成功且 LSP 诊断为零 |

定点复测耗时 7.878 秒、3 次工具调用、报告 13,713 Token；它不替代完整矩阵失败记录。没有配置模型费率，美元成本未知。模型同属一个服务商，任务数量少且限流占比高，不能据此声称通用能力达标或给产品排名。

原始产物：

- `D:/User/Desktop/Project/Test-CLI/workbench-20260927-matrix`
- `D:/User/Desktop/Project/Test-CLI/workbench-20260927-matrix-r2`
- `D:/User/Desktop/Project/Test-CLI/workbench-20260927-edit-fix`

移除本地路径和评测会话 ID 的分发版报告已加入 `cli/publish/docs/evaluation/workbench-*.json`，方法与说明见 `cli/publish/docs/EVALUATION.md`。

## 候选包与剩余工作

已实际验证的文件：

- `outputs/release/0.2.0-rc.4/achernar-code-0.2.0-rc.4.zip`
- `outputs/release/0.2.0-rc.4/achernar-code-0.2.0-rc.4.tgz`
- `outputs/release/0.2.0-rc.4/package-verification.json`

ZIP SHA-256：`68891f0c34b05e82f3a4ead925c68c257ea6169d2276b1cc8a6a6b221df8c4ca`

TGZ SHA-256：`afb79feb9998a90bfd8dc79529067b464ff034240f894d4363bbe158fe7a80d3`

保留 13 个官方编程 Skills、7 个 CLI 适用 Plugins；独立包不包含桌面控制实现。

真实模型全套门禁仍未通过，需在服务商限流恢复或有合适额度的环境再测。远程 GitHub Actions 查询因本机连接中断失败，当前工作区也没有 Git remote；没有把历史远程结果当成本次结果。CI 需要 `ACHERNAR_EVAL_API_KEY` secret，以及 `ACHERNAR_EVAL_BASE_URL`、`ACHERNAR_EVAL_MODELS` variables；可选接口格式变量为 `ACHERNAR_EVAL_API_FORMAT`。GitHub 合并规则需另行配置，本地工作流不会自动启用分支保护。当前不作为已通过发布条件的版本宣传。
