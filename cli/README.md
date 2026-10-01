# Achernar Code

专注编程的 Node.js CLI，与 Achernar 桌面端共用模型适配、工具循环和执行准则。

## 安装

候选发布包需要 Node.js 22.22.2 或更新版本；rc.5 已通过 Windows/macOS/Linux × Node 22/24 的远端检查。每个后续版本的验证结果以对应 CI 为准。也可使用独立 ZIP，解压后：

```powershell
npm ci
npm link
achernar
achernar --json doctor
```

在项目源码内也可运行 `node cli/index.js`。`npm link` 后可以从其他项目运行 `achernar`。

ZIP 含固定版本的 `package-lock.json`，`npm ci` 安装经测试的依赖图。当前源码准备的是 `0.2.0-rc.6` 候选包；公共 npm registry 的发布状态以实际查询结果为准。安装需要 npm registry 网络访问。通过 npm 分发的包固定直接依赖版本，但不保证所有传递依赖与源码锁文件完全一致。桌面应用、桌面语音运行时和系统控制能力不包含在独立 CLI 包中。

安装后，在 **CMD 或 PowerShell 直接输入 `achernar`** 即进入英文终端界面。黑白填充标题和恒星环绕动画居中，背景沿用终端默认底色；圆角多行输入框下方左侧显示 token/s 与累计用量，右侧显示上下文占用。开始对话后，输入框固定底部，双方输出靠左并保留少量边距。思考、工具调用、正文与代码块分层显示，执行时有小恒星旋转动画。

使用 `achernar --no-animation` 或 `ACHERNAR_NO_ANIMATION=1` 关闭动画；`NO_COLOR` 关闭颜色；`--plain` 保留简单行式聊天（不含管理弹窗与鼠标交互）。JSON 命令不输出界面控制码。

## 交互与实时控制

输入 `/` 在上方展开指令；鼠标悬停高亮，点击选中。Enter 执行管理指令，Tab 只补全。Alt+Enter / Ctrl+J 换行，PgUp/PgDn 或滚轮翻阅输出，Esc 关闭菜单或停止任务。启用鼠标捕获后可用 Shift+拖动选择终端文本（取决于终端设置）。

**Ctrl+P** 或 `/commands` 搜索所有命令，命令名称匹配优先于说明文字；取消会回到原草稿。`/settings` 是模型、执行限制、预算、扩展与语言的分组入口。多行输入支持按视觉列上下移动、Ctrl+←/→ 跳词和 Ctrl+W 删除前一个词；打开选择框或文件预览后，原草稿和光标位置会保留。

在 **`/session`** 列表选中会话后，按 **Delete** 或点击底部 **Del 删除**，即可打开删除确认框。确认框显示会话名称、ID 和删除范围，默认选中“保留会话”，Esc 取消。删除只移除会话记录，保留项目文件；正在运行的会话不能删除。删除当前会话后回到新会话，删除其他会话不影响当前内容。右下角 Tips 和 `/shortcuts` → Text and navigation 都会提示这个操作。脚本中可使用 `achernar session-delete <id> --yes`。

| 工作台入口 | 可用操作 |
| --- | --- |
| `/files [路径]` | 选择源文件，查看有行号与语法颜色的内容；键盘和滚轮翻页，Esc 返回。最多预览前 128 KiB，截断时明确标注。 |
| `/search [文本]` | 本地搜索；不传文本时依次选择字面/正则、包含与排除 glob。 |
| `/git`、`/diff` | 选择变更文件，查看工作区/暂存区 diff 或最近提交。 |
| `/doctor`、`/doctor probe` | 检查配置和执行环境；probe 额外请求服务商模型列表。 |
| `/cost`、`/output` | 查看用量与预算，或在可滚动窗口阅读上次回答。 |
| `/agents on\|off`、`/output-limit` | 保存只读子代理开关和每次模型响应的输出上限。 |

上述本地浏览、搜索、Git 查看和配置菜单不调用模型。预览目前是只读的；文件编辑由 AI 文件工具执行。需要传入多行代码时也可使用以下无交互入口，UTF-8 任务文件和 stdin 都有 200000 字节上限：

```powershell
achernar run --task-file .\task.md --approval code
Get-Content -Raw .\task.md | achernar --stream-json run --stdin --approval code
```

输入框上方显示执行模式与审批档位。**F2** 循环切换审批；**Shift+Tab** 循环切换 Code / Plan / Review。可点击标签，或输入 `/approval strict|code|auto` 与 `/mode code|plan|review`。运行中同样生效，并有即时提示。

任务计划显示在输入区上方的边框卡片中，实时更新完成数量；点击标题或按 **F5** 展开/收起，长计划可在卡片内滚动。新任务清空当前计划，上一轮的计划仍可在输出记录中查看。工具调用默认显示单行摘要，过长的指令和网址以省略号收尾；点击或按 **F3** 查看完整参数，输出可单独展开，**F4** 统一展开/收起。

| 审批档位 | 行为 |
| --- | --- |
| Strict | 对工具操作逐项审批，包括读取与联网；计划更新、向用户提问及服务/目录清单不需要审批。 |
| Code | 自动批准源码/文本读取、写入和编辑以及文件搜索/列表，其他操作仍审批；删除文件仍审批。 |
| Auto | 自动批准工具操作。 |

首次审批弹窗同时提供 Allow once、Deny 和三档模式。切换时重新判断正在等待的审批，后续工具执行前读取最新策略；已经运行的命令不会因切换自动撤销，需 Esc 停止。`--approval ask` 是 Strict 的兼容别名。

Plan / Review 在工具层强制只读。AI 可以使用 `execution_mode` 随任务阶段切换，并显示原因；用户选定的只读模式不能被 AI 擅自解除，AI 不能修改审批策略。

## 工作目录与跨目录

默认以启动命令时所在目录为项目，而不是 Achernar 的安装目录。例如：

```powershell
cd D:\Projects\Website
achernar
```

也可以直接指定项目，并将需要协作的其他目录加入同一工作区：

```powershell
achernar -C D:\Projects\Website --add-dir D:\Projects\Shared
```

`--add-dir` 可以重复传入。交互中支持：

```text
/dirs
/add-dir D:\Projects\Shared
/cd D:\Projects\AnotherProject
```

`/add-dir` 保留当前对话，并允许工具访问该目录；路径有空格也可以完整输入或加引号。`/cd` 切换主项目并开始新会话，原有会话仍可通过 `resume` 恢复。跨目录相对路径默认基于主项目，模型可通过 `files.root` / `terminal.cwd` 选择已加入的目录。

执行模式下，AI 需要其他目录时可通过 `workspace.add` 提出访问请求；即使开启 `--approval auto`，新增目录仍需要确认，或由用户预先 `--add-dir`。只读计划/审查可以访问已加入的目录，但不能自行扩展范围。恢复会话时保留主项目与已加入目录，写入/命令审批仍按当前模式生效。此范围管理针对工具调用，终端仍具有当前用户权限，并非操作系统沙箱。

## 模型

```powershell
achernar config set --model your-model --base-url https://your-provider.example/v1
$env:ACHERNAR_API_KEY = '你的密钥'
achernar doctor --probe
```

支持 `openai-chat-completions`、`openai-responses`、`anthropic-messages`、`gemini`，通过 `--format` 指定。

在终端输入 **`/model` → Create model**，或 `/model add`，逐步填写服务商、Base URL、API Key、模型 ID、接口格式与上下文上限。**Esc 返回上一步并保留草稿**，在服务商步骤退出才取消整个流程。`/model edit` 编辑当前配置；`/provider`、`/format`、`/context` 可直接修改单项。

API Key 输入会遮挡，不进入会话日志或进程参数。Windows 使用当前用户 DPAPI 加密，保存到 CLI home 的 `credentials.json`；其他系统使用环境变量。保存的密钥绑定接口地址和格式，不在切换地址后自动复用。配置文件和模型资料只保存加密凭据的引用，不保存明文 Key。

端点/模型优先级：命令参数 → `ACHERNAR_BASE_URL` / `ACHERNAR_MODEL` / `ACHERNAR_API_FORMAT` → `~/.achernar-cli/config.json`。密钥优先级：`ACHERNAR_API_KEY` → 匹配的 Windows 加密凭据 → `keyEnv` 或提供商标准环境变量。本地无鉴权服务可留空。`ACHERNAR_CLI_HOME` 可覆盖保存目录。

模型列表会查询当前服务商；服务商不支持模型发现时可手动填写 ID。`/model import <文件>` 或 `/import models <文件>` 支持：

```json
{"models":[{"name":"Local coder","modelId":"coder","baseUrl":"http://localhost:11434/v1","apiFormat":"openai-chat-completions","contextWindow":128000,"keyEnv":"LOCAL_API_KEY"}]}
```

导入文件不接受明文凭据，使用 `keyEnv` 或创建向导中的加密输入。

## 使用

```powershell
achernar -C D:\YourProject chat
achernar run "修复登录超时问题，运行相关测试"
achernar run --plan "为项目添加导出功能"
achernar review "检查最近修改的认证逻辑"
achernar sessions
achernar resume <会话ID> "继续验证"
achernar diff
achernar search "handleSubmit"
achernar search "handle[A-Z]\w+" --regex --include "**/*.{ts,tsx}" --exclude "**/*.test.ts" --limit 80
achernar inspect
achernar skills
achernar skills skills/achernar/achernar-coding
achernar tool-call files '{"action":"read","path":"package.json"}'
```

完整终端支持 `/help`、`/model`、`/provider`、`/format`、`/context`、`/new`、`/clear`、`/sessions`、`/resume`、`/status`、`/approval`、`/mode`、`/plan`、`/review`、`/test`、`/cd`、`/add-dir`、`/dirs`、`/skills`、`/plugins`、`/mcp`、`/import`、`/exit` 和实际安装的扩展指令。管理指令不消耗模型 Token。`/clear` 清空显示但保留会话；`/new` 开始新会话；`/sessions` 恢复记录但不自动执行任务。

`run --agents` 或 `chat --agents` 可启用只读研究员和审查员。模型按任务需要委派，最多同时 2 个、每轮最多 6 个子任务，子任务不能继续委派或修改文件；该功能会增加模型调用。计划/审查模式不启用委派。

默认 Strict，先读后改并逐项审批。无交互环境下不能批准的操作会被拒绝；自动化任务需明确使用 `--approval code` 或 `--approval auto`。`--plan` 与 `review` 在工具层禁用写操作及终端。该实现是工具权限控制，**不是 OS 沙箱**；自动模式下 shell 拥有当前用户权限。删除文件移动到 CLI home 的 `trash` 中。

每次任务默认最多 40 轮（`--max-rounds` 范围 1–120），30 分钟超时；Ctrl+C 停止当前任务。已完成文件操作保留。`resume` 在原项目路径继续，保存工具记录以便模型核对，不自动重放命令。会话锁避免同一会话同时修改；终端崩溃后如遗留 `.lock`，确认原进程退出后才可移除。

模型会收到每轮剩余额度，最后 3 轮提醒优先完成必要交付和验证，终端同步显示提示。达到上限仍未结束时保持失败状态和已完成操作，不发送“任务完成”通知。

文件摘要有数量与字节限制，排除常见依赖目录、凭据文件和符号链接；这是文件路径检索索引，不是 AST/调用图。根 AGENTS.md 自动加载，子目录规则由 Agent 按需读取。Skills 按选择加载；CLI 不包含桌面操控或文档导出工具。

恢复会话时，模型接收精简的历史执行记录：代码正文与旧读取内容换成长度和内容指纹，保留路径、操作、错误、审批拒绝、退出码与必要的输出片段。完整记录仍保存在本地会话中；历史片段不是当前文件状态，继续编辑前应重新读取。此优化只影响 CLI 发送给模型的旧工具记录，不裁剪用户原文、最终答复或当前执行中的工具结果。

## 扩展导入与联网

官方 Achernar Skills 和 Plugins 全部随 ZIP 打包，作为受保护的内置库保留。用户导入内容位于独立目录，不覆盖官方资源，界面不提供删除官方扩展的入口。

- `/skills`：查看、调用、导入含 `SKILL.md` 的目录。
- `/plugins`：查看、调用、导入含 `README.md` 和可选 `.mcp.json` 的目录。
- `/mcp`：导入配置、启停服务、查看连接、连接后发现工具。
- `/import skills|plugins|mcp|models <路径>`：直接导入，相对路径基于当前项目。

导入的 MCP 服务初始禁用，导入本身不执行程序。支持 stdio 和 Streamable HTTP；暂不支持旧 SSE 及第三方专属授权流程。MCP 示例：

```json
{"mcpServers":{"example":{"command":"node","args":["D:/Tools/server.js"],"env":{"API_KEY":"${env:EXAMPLE_API_KEY}"}}}}
```

已接入官方搜索、Context7、Git、JSON、npm、项目检索、运行时检查插件；发现和调用遵循实时审批。外观、桌宠、原生桌面操控等插件保留说明并标明需要桌面宿主；任意第三方宿主钩子不会仅因导入而自动可执行。

联网可以直接调用 `web.search` / `web.read`，或通过 MCP 调用官方检索插件。内置 `achernar-web-research` 已补充 CLI 工具路径、官方文档优先、版本核对、按需读取、引用来源及查询失败处理。

官方 `achernar-coding` 用于编程实现和验证，`achernar-ui-design` 用于网站与软件界面。UI Skill 附带三套可运行的原创 HTML 模板：`workbench`（工作台）、`data-overview`（数据概览）、`editorial`（内容展示）。均支持离线运行、SVG、深浅色和窄屏。Agent 可用 `files.write` 的 `template` 参数直接复制到新 `.html` 文件，再按任务改造；复制不需要逐字生成模板，仍受实时审批和只读模式限制，不覆盖现有文件。可通过 `/skills` 选择 UI Skill；自然语言 UI 任务也有自动路由提示。模板含示例数据，接入真实业务仍需实现并验证。

## Token 状态

执行中可继续输入补充要求，按 Enter 加入当前任务队列（最多 8 条），在当前模型响应或工具批次结束后应用。Ctrl+C / Esc 停止时，尚未应用的输入恢复到编辑框。审批与模式快捷键仍即时生效。

AI 提出的选项会以终端菜单呈现：支持单选、多选、自定义回答和 Esc 取消，与审批共用串行等待队列；多个子代理同时提问也不会互相覆盖菜单。

`/details` / **Ctrl+O** 切换工具详情，`/thinking` / **Ctrl+T** 切换模型提供的思考文本显示；偏好自动保存。它们只改变显示，不改变服务商推理能力。中途进展使用低对比文字，最终回复单独标记 **Result**；**Run summary** 根据实际工具事件列出文件、命令和退出码，不把任意 exit 0 当成“测试通过”。

`/session`（或 `/sessions`）列出历史会话。选择记录后可 **Resume session** 或点击红色 **Delete session**，删除需要确认。仅删除会话记录，保留项目文件；当前任务或该会话在另一个终端运行时禁止删除。删除当前空闲会话后回到新对话。

`/model` 默认仅列出已配置模型，当前模型不重复显示。选择 **Show provider models** 才查询其他模型；**Hide provider models** 可收起，展开操作本身不会切换模型。

回复正文相对 Achernar 标题缩进，标题前不再显示星星。思考默认收起；工具命令与控制台输出使用灰色底、细边框卡片，可点击标题展开/收起，控制台结果可单独折叠。工具执行时实时显示输出，成功后自动收起；手动调整后保留选择，失败保留错误详情。**F3** 切换最近一张卡片，**F4** 展开/收起全部详情。欢迎页的恒星标题动画保留。

Windows 系统通知默认开启：任务完成后提醒一次，等待审批、回答或授权新工作目录时提醒。自动批准的操作、菜单重绘和模型配置不触发提醒；取消或失败不提示“已完成”。CLI 通知跟随所选语言，使用当前用户注册的 Achernar Code 通知身份，不在通知中展示命令、密钥或对话正文。通知失败不影响任务或 `--json` 输出。

通知通常出现在 Windows 右下角；系统的免打扰及通知设置决定是否显示横幅。默认仅交互终端发送任务通知，JSON、管道和无人值守运行保持安静。可用 `--no-notifications` 或 `ACHERNAR_NOTIFICATIONS=0` 关闭。已解决的审批、取消和失败不发送完成提醒。CLI 通知用于提醒，查看结果与回答请返回原终端。

左侧显示服务商报告的累计输入/输出 Token（包括子代理）和主代理输出速率。`token/s` = 已报告输出 Token / 模型请求时间，包含首字等待，排除工具时间。重复累计 usage 包按调用轮次去重；服务商未报告时显示 `—`。只有收到 usage 才刷新真实计数，不伪造逐字符速率。

右侧显示当前上下文/配置容量及百分比，`≈` 表示本地估算。容量使用模型元数据或 `/context`，不从模型名称猜测。新建或恢复终端会话从新的用量计数开始。

## 自动化输出

`--json` 输出一个稳定 envelope，进度不会混入 stdout：

需要实时机器输出时使用 `--stream-json`：每行一个 `{type:"event",sessionId,event}`，最后一行 `{type:"result",ok:true,data}` 或 `{type:"error",ok:false,error}`。原有 `--json` 单对象格式保持兼容。`finalContent` 是最终答复，`content` 保留整轮文字，`totalUsage` 累加当前主代理各轮服务商已报告的用量（不包含未报告的计数，亦不包含独立压缩/子代理调用）。

```json
{"ok":true,"data":{"sessionId":"...","content":"...","events":[]}}
```

```json
{"ok":false,"error":{"code":"ACHERNAR_ERROR","message":"..."}}
```

`doctor` 返回配置、授权来源与缺项，默认不联网；缺少凭据以 `ready`/`missing` 表示。`--probe` 实际读取模型列表。`skills` 返回扩展条目数组或单项文档，`search` 返回 `matches` 与 `truncated`，`diff` 返回 `status/diff/staged`，`run/review/resume` 返回会话 ID、结果与事件。退出码成功 0，配置/网络/执行错误非 0。`tool-call` 为只读逃生口，不能借此运行任意命令。

示例：`achernar --json run --approval auto "修复并验证指定缺陷"`。自动执行仅适合你信任的项目与任务。

## 运行设置与验证

`/settings` 打开设置菜单，`achernar settings` 输出当前配置。例如：

```powershell
achernar settings retries 3
achernar settings commandTimeoutMs 600000
achernar settings taskTimeoutMs 1800000
achernar settings autoDiagnostics true
achernar settings readCache true
```

时间单位为毫秒。命令默认 10 分钟，可指定最长 1 小时；整项任务默认 30 分钟，可配置到 4 小时，任务取消/到期仍终止命令。`--retries`、`--timeout-ms`、`--task-timeout-ms` 可覆盖单次启动配置。设置从下一项任务生效；审批档位仍实时生效。桌面「设置 → 程序设置 → 任务运行」使用同一套校验规则，分别保存两端的配置。

请求在网络暂时失败或 HTTP 408/429/500/502/503/504 时执行有上限的指数退避，遵守 Retry-After。等待可取消；服务商要求的等待超过配置上限时返回错误，不提前重试。已经开始输出的响应不自动重放。

`files.search` 和 `achernar search` 都支持 `regex`、`include`、`exclude`、`caseSensitive`、`limit`。无目录前缀的通配符匹配任意深度文件。正则在独立 Worker 中执行，超过 1 秒终止。结果有文件数、字节和行数上限，`truncated` 表示可能还有结果。

修改文件前显示统一 diff；终端使用 PgUp/PgDn 或预览区滚轮翻页，上下方向键选择审批操作。预览生成后文件若被用户改动，写入会拒绝并要求重新读取。普通文件读取按当前字节指纹去重，`fresh:true` 可强制重新返回内容。

写入与编辑完成后自动诊断 JS/TS 和 JSON，将结果传给下一轮模型请求。CLI 使用已打包 LSP，桌面使用独立 TypeScript Worker，均不运行项目脚本。其他语言显示未验证，仍需相应编译器或测试。Docker 模式不启动宿主 LSP。单文件诊断通过不等于项目构建或测试通过。

原生代码查询：`achernar code symbols src/main.ts`、`achernar code diagnostics src/main.ts`。定义、引用和类型查询使用 `--line`、`--column`，从 1 开始，列号按 UTF-16 计算。

`/shell` 与 `/sandbox` 保存执行环境，`--shell`、`--sandbox` 可临时覆盖。Docker 隔离终端，宿主 MCP/LSP 仍禁用；`achernar --json doctor` 显示实际边界与可用性。`achernar ide --write` 可添加 VS Code 任务；扩展包用 `extensions pack/import` 分发。

## Git、预算与故障转移

Agent 可调用原生 `git` 工具的 `status`、`diff`、`log`、`stage` 操作。暂存只处理明确指定的路径，不执行提交、重置或清理，仍受审批约束。裸 `exit 0`、`true`、`echo done` 等没有实际检查作用的命令会被抑制。

```powershell
achernar pricing 1 2
achernar budget 0.50
achernar --max-cost 0.25 run --approval code "修复指定错误并验证"
achernar budget off
```

`1 2` **仅是配置格式示例，不是任何模型的真实价格**：分别为每百万输入/输出 Token 的美元单价。`/pricing`、`/budget` 是对应交互入口；`--input-price`、`--output-price` 可覆盖费率。任务费用包含摘要和子代理，显示在输入框下方。未知价格显示 unknown，不当成免费；预算要求所有候选模型都有费率。切换模型会清除未随新配置提供的旧费率。

每次自动重试也单独计入任务预算。收到明确 HTTP 拒绝时按未生成处理；连接中断、无法确认用量时按该次预留量保守计费，剩余预算不足则不发送重试。等待重试期间取消，不计入尚未发出的下一次请求。

每次请求预留输入与有上限的输出费用，并发调用共享预算。缺少 usage 或连接中断时保守记账。服务商计量、隐藏推理和额外收费可能与估算不同，所以这是后续请求熔断，**不是服务商账单的绝对上限**。`--max-output-tokens` 默认 4096。

`/fallbacks` 或 `achernar fallbacks add <档案名称或模型ID>` 选择已配置备用模型，`fallbacks clear` 清空。导入模型 JSON 可包含 `pricing: {"input":1,"output":2}` 与 `keyEnv`，禁止内嵌密钥。HTTP 4xx/5xx 或网络故障只在尚未输出文字、思考或工具参数时切换；已开始的流不会重播。记录每次实际模型，上下文按候选模型中最小容量约束。

## 中间限制与 Hooks

```powershell
achernar --sandbox restricted --write-dir src --write-dir tests run --approval code "修复测试"
achernar hooks import D:\Tools\achernar-hooks.json
achernar hooks show
achernar hooks clear
```

`restricted` 是内置文件工具的写路径白名单，未指定路径时仅允许主项目。检查包含链接真实目标，并在审批后再检查。MCP/LSP 保持可用；shell、MCP 和 Hooks 仍有宿主权限，**不是 AppContainer、Job Object 或 OS 沙箱**。终端隔离仍用 Docker。持久白名单可在 CLI home 的 `config.json` 中设置 `writePaths`。

Windows 还可选 `achernar --sandbox job --job-memory-mb 1024 --job-processes 32`，或在 `/sandbox` 菜单中选择 Windows Job。终端进程先暂停创建、加入 Job 后才执行；总提交内存和活动进程数受限，根命令退出时清理子进程。无法加入 Job 时明确失败，不回退成无限制运行。MCP/LSP 保留在宿主运行；Job **不是文件系统、网络或权限隔离**，命令仍拥有用户权限。

Hooks 只加载显式导入的用户配置，不自动执行仓库脚本：

```json
{
  "tool_pre": [{"command":"node","args":["D:/Tools/check-tool.js"],"timeoutMs":10000}],
  "tool_post": [{"command":"node","args":["D:/Tools/record-tool.js"],"timeoutMs":10000}]
}
```

脚本通过 stdin 接收含 `version/event/sessionId/name/arguments/project/result` 的 JSON，继承筛选后的环境。stdout 为 JSON 或空；pre 输出 `{"decision":"deny","message":"原因"}`、非零退出或超时都阻止操作。post 失败只警告，不改变原操作结果。Hooks 不能替用户批准操作，不接收程序已知的模型密钥。它们仍是拥有宿主权限的用户脚本。

工作目录操作、执行模式切换和 `delegate` 委派也会经过 Hooks；拒绝委派会阻止子代理模型请求。子代理实际使用的工具仍各自经过 Hooks。工具本身失败时，post 收到 `error`；pre 已拒绝或现有权限检查未通过的操作不会执行，也不触发 post。

## 任务撤销、导出与语言

- `/undo`：恢复上一任务之前的文件和对话，把用户原话放回输入框。
- `/redo`：恢复刚撤销的任务。开始新任务后不保留 redo 分支。
- `/export <文件>`：导出脱敏会话 JSON，移除附件、凭据字段、工作目录与已知密钥，不修改原会话。
- 无交互入口：`achernar undo <ID>`、`achernar redo <ID>`、`achernar export <ID> <文件>`。

真实快照支持跨 admitted 目录、部分失败任务和重启。用户后续修改文件时，撤销拒绝覆盖。默认容量 256 MB / 20,000 条目；超限、链接变化、不完整快照、项目外 Git 索引等情况会明确报告不可撤销。终端/MCP/Hooks 在已跟踪项目之外的副作用不在快照范围内。导出无法识别所有自然语言隐私，分享前仍应查看文件。

`/language` 或 `--language auto|en|zh-CN|ru|ja|ko|es` 控制主要界面和通知语言，默认跟随系统；技术详情和未翻译条目保留英文。JSON/JSONL 系统 `status/message/error` 固定英文，用户原文、模型回复、代码和命令输出保持原语言。最终 JSON 包含 `cost` 和 `checkpoint`。

## 推理强度、模型操作与消息

`/reasoning` 选择当前模型支持的强度，或配置自定义显示名称和实际 API 值。`Provider default` 不发送参数，交给服务商决定，并不保证关闭思考。自定义项须采用服务商支持的值；更换端点或模型时会清理旧模型的强度能力，保存的模型资料保留各自的设置。

```powershell
achernar reasoning high
achernar reasoning --mode custom --options-file reasoning-options.json
achernar --reasoning low run "Inspect this project"
```

在 `/model` 中选中已保存的模型后，Ctrl+E 编辑、Delete 删除；删除需确认。移除模型不会删除会话或项目文件。

用户消息使用灰色背板。点击消息可复制，或撤回到该消息之前并恢复输入草稿；撤回有文件冲突检查，避免覆盖用户在任务后自行作出的改动。Ctrl+U 撤回最近任务，Ctrl+R 恢复。`/shortcuts` 查看和修改快捷键，底部 Tips 轮换显示操作提示。

拖动鼠标可选中终端内容。选中后画面冻结以保留文字位置，后台任务继续；Ctrl+C 复制选区，Esc 清除选区并恢复实时显示。没有选区时 Ctrl+C 保持原来的停止/退出行为。

运行中输入 `/` 可继续打开建议菜单。模型或强度修改用于后续任务，不会中途改变已经发出的模型请求；审批模式仍实时应用。

## CLI 更新

安装发行版后，`/update` 提供检查更新、提醒开关和确认安装。命令行也支持 `achernar update`、`achernar update --install`。预览版使用 `next` 通道，正式版使用 `latest`，预览安装也能识别更高的正式版。

安装版每天检查一次官方 npm 包，离线不影响使用，不在后台强制安装；源码链接入口不会被交互式更新覆盖。更新后重启，配置和会话保留在 CLI home。注册表发布尚需完成 npm 的发布验证，完整发布步骤见 `docs/UPDATES.md`。

## 固定任务回归

```powershell
npm run eval:cli -- --fixture --out output/eval-fixture-unique
npm run eval:cli -- --live --out output/eval-live-unique --threshold 1
npm run eval:cli -- --live --models model-a,model-b --out output/eval-matrix-unique
```

以上用于源码仓库；独立包用 `npm run eval -- ...`。安装后也可 `achernar eval --live --out <新目录>`。`--live` 使用当前模型完成五个固定编程任务并独立验收：JSON 修复、跨文件计算、边界函数修复、过滤搜索和带诊断的类型修复。记录模型、源码指纹、Token、耗时与失败，会产生服务商用量。`--models` 对同一端点的多个明确模型逐个执行，每个模型都需独立达标。`--fixture` 只测试协议和验收链路，不是模型能力评测。完整状态见 `docs/RELIABILITY.md`，测量见 `docs/EVALUATION.md`。

评测先验证阈值、费率和预算，再创建产物并请求模型。覆盖端点或接口格式时不读取旧端点的已保存密钥；覆盖模型时不沿用旧费率和上下文容量。失败报告保留此前已报告的 Token 和最后费用状态，并用 `usageComplete:false` 标明用量不完整，不将缺失用量记为零。

`files.edit` 同时接受 `oldText + content` 和 `oldText + newText`。两者使用同一差异预览、审批、写入和自动诊断链路；两个替换值冲突会拒绝，拒批或文件已变化时不写入。`newText` 不用于 `files.write`。
