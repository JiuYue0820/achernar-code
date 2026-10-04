# 本轮可靠性改进与验证

> 这是前一轮的历史记录。后续 CLI 清单、费用/Hooks/撤销/eval 的实现与新结果见 [CLI 升级验证](cli-upgrade-verification.md)。

已完成：CLI/桌面运行设置、请求重试与可取消退避、可配置命令/任务时限、正则与包含/排除搜索、diff 审批、审批期间文件冲突保护、编辑后自动诊断、读取结果去重、上下文压缩降级，以及子代理继承重试配置。

运行设置只展示已经接到执行流程的选项。成本预算、Hooks、CLI checkpoint 和新的记忆策略仍未完成，不把占位开关计入已实现功能。逐项对照评测意见见 [完整进度](../cli/publish/docs/RELIABILITY.md)。

## 验证结果

运行环境：Windows，Node.js v24.15.0；桌面测试启动真实 Electron 应用。

| 检查 | 结果 |
| --- | --- |
| `npm run test:all` | 197 项：194 通过，3 跳过，无失败 |
| `npm run test:cli-tui` | 46 项全部通过 |
| 可靠性专项测试 | 搜索过滤/正则限时、真实 HTTP 错误与 Retry-After、退避取消、流中断不重放、设置保存、diff/冲突保护、实际 TypeScript 与 JSON 诊断、压缩保留需求与拒绝记录、子代理配置继承通过 |
| `tests/runtime-settings-smoke.js` | 真实设置界面修改与重载保存、HTTP 重试、深浅色 diff、诊断反馈到下一轮并修复错误通过 |
| `tests/approval-workspace-smoke.js` | 流式预览、拒绝新建/编辑、取消、运行中自动审批、编辑器与侧边布局通过 |
| `npm run test:cli-package` | 独立目录安装后 76 项：75 通过，Docker 检查 1 项跳过；随后 npm 打包、在第二个独立目录安装和运行验证通过 |
| `git diff --check` | 通过 |

以上套件有重叠，不能相加视为独立用例总数。跳过项为未启用的 Docker 集成和两项原生 SenseVoice 集成；没有将其计为通过。Node 文档测试中已有 DOMMatrix/Path2D 可选 polyfill 警告，保留在完整日志中。

本轮使用本地确定性 HTTP fixture（模型 ID 为 `fixture`、`runtime-fixture`、`child-fixture`、`package-fixture`）。这些检查验证工程行为，**不是接入真实模型的能力评测**，没有新增模型排名或对比结论。

## 本地候选包

- [npm tgz](../outputs/release/0.2.0-rc.4/achernar-code-0.2.0-rc.4.tgz)
- [独立 ZIP](../outputs/release/0.2.0-rc.4/achernar-code-0.2.0-rc.4.zip)
- [安装验证报告](../outputs/release/0.2.0-rc.4/package-verification.json)
- [源码测试日志](../outputs/reliability-tests.log)
- [独立包测试日志](../outputs/reliability-package.log)

版本 `0.2.0-rc.4` 尚未上传 GitHub 或 npm，没有触发远端 CI。本地包中保留 13 个官方编程 Skills 和 7 个适用于 CLI 的官方 Plugins，未带入桌面控制实现。

TGZ SHA-256：`741ecd46084e0d7dd46335c1f856d917dd8a8661a1eefe5e44ba2bacc2cf8970`

ZIP SHA-256：`a4872f90bf5cffc59898df6e62d40ab33e54cfe179a191f10a377aa941a7d0ad`

## 剩余发布前工作

成本统计/限额、故障转移、原生 Git 工具、CLI 任务级撤销、Hooks、进一步进程隔离以及真实模型回归门禁仍需继续。已有 Docker 隔离边界和文件路径限制不等价于完整操作系统沙箱。远端 CI 需要实际推送后另行验证。
