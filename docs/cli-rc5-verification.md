# Achernar CLI rc.5 核验记录

日期：2026-09-27。范围：CLI 代码、交互、可靠性、发行与更新。桌面应用继续测试，不包含在发布物中。

## 工程调整

- 将模型列表、模型编辑、推理配置、快捷键、终端按键处理、选区、配置读写和更新处理拆成独立模块；命令分发使用 Map，帮助文案单独维护。
- CLI JavaScript 统一 strict mode、Prettier 和 ESLint。加入覆盖率报告，并在独立仓库 CI 执行 lint、格式、单元/集成、夹具评测和实际安装检查。
- 配置缓存随文件变化失效，返回独立副本。流式输出脱敏不再逐 Token 重读配置与解密凭据。异常边界保留服务错误码，区分常见配置、会话、网络、限流和超时错误。
- 文件写入策略复用同一函数；审批前后、用户 hooks 前后的检查保留，因为等待过程中权限和执行模式可能变化。
- 修正干净环境评测输出父目录创建，以及 LSP 项目别名/Windows 短路径的一致性。Windows Job Object 测试必须证明真实执行与子进程限制，超时不算通过。

## CLI 体验

支持 `/reasoning` 自定义名称/API 值；模型列表 Ctrl+E 编辑、Delete 删除。用户灰色消息支持复制与撤回，`/shortcuts` 管理快捷键。运行中可使用斜杠建议；选中输出时冻结画面，任务继续，Ctrl+C 复制，Esc 恢复实时显示。工具/思考默认收起。

命令说明与更新操作有中文、英文、俄语、日语文案；代码、命令、模型 ID 和模型输出不翻译。技术错误和未覆盖文案仍可能保留英文，不声称全量翻译审计已经完成。

已查看宽/窄终端和中/俄文运行态的单元格渲染预览。该预览不是原生终端截图，也不能代替各宿主的剪贴板实测。

## 本地证据

| 检查 | 记录 |
| --- | --- |
| lint / format | 通过 |
| CLI 覆盖率基线 | 144 项，143 通过，1 项 Docker 需显式启用而跳过 |
| 覆盖率基线 | 行/语句 79.26%，分支 78.49%，函数 86.36% |
| 共享 agent/provider/search/package | 32/32 |
| 最终独立源码树 | 158 项，157 通过，1 项 Docker 显式启用测试跳过，0 失败 |
| 最终独立安装 | npm pack → 外部目录安装 → 13 项行为核验通过；版本 0.2.0-rc.5 |
| 确定性编程夹具 | 5/5；不计作真实模型得分 |
| Web Search | 短查询及中英混合查询实际返回结果；不保证每个网站可达 |

覆盖率基线在远端路径修复前采集；最终独立源码和安装检查在修复后重新运行。最终包包含 13 个官方 Skills、7 个官方 Plugins。测试互有覆盖，不将上述数量相加。

## 真实模型

端点均为 `https://api.deepseek.com`，模型 ID 按请求原样记录。完整数据在 [公开评测数据](../cli/publish/docs/evaluation/reasoning-20260927.json)。

| 模型 / 推理值 | 固定任务通过 | 累计耗时 | 输入 / 输出 Token | 估算 USD |
| --- | ---: | ---: | ---: | ---: |
| deepseek-flash / low | 5/5 | 26.235 秒 | 83,528 / 2,538 | 0.028104 |
| deepseek-v4-pro / high | 5/5 | 47.999 秒 | 90,956 / 2,975 | 0.131843 |
| deepseek-flash / none | 1/1 类型编辑 | 4.614 秒 | 16,201 / 387 | 0.005325 |
| deepseek-v4-pro / 自定义 max | 1/1 类型编辑 | 6.132 秒 | 12,040 / 340 | 0.017239 |

估算费用采用测试配置的保守费率，不是服务商账单。每任务 120 秒、4,096 输出 Token、0.20 美元预算；整套 10 轮，定点 8 轮。小任务只能证明这些场景的集成表现，不做排名或竞品比较。OpenCode Zen 凭据校验 HTTP 401，未取得新的成功评测；历史失败和辅助续跑记录仍保留。

## 更新与发布

`/update` 和 `achernar update` 检查官方 npm 包；安装版每日后台检查并提示，用户确认后安装指定版本，重启生效。正式/预览通道分开，预览用户可升级到更新的正式版。源码链接入口不被交互式更新覆盖。

独立仓库：`JiuYue0820/achernar-code`。Git 连接不稳定时，本次通过 GitHub Git Data API 以原提交为父提交上传 CLI-only 内容，未上传桌面工程。分支：`codex/cli-rc5-engineering-updates`。

npm 尚未登录、包名尚未发布。首次发布需要维护者登录；随后可配置 trusted publisher 和 `ACHERNAR_NPM_PUBLISH_ENABLED=true`，版本标签通过检查后自动发布。首次注册表发布前，不声称用户已经能从 npm 收到公开更新。

运行时代码提交 `763ccb7e03c99096a4f24f1bcab216332d296c56` 已通过远端 CI `36292085382`：Windows/macOS/Linux × Node 22/24 全部通过，单独的真实 Docker 测试通过；可选真实模型 CI 未启用，不能计为通过。最终文档及发布流程提交为 `726269314d2ce4acf254f7732c7c9911aae98637`，对应 CI `36292348821`。

最终发布文件保存在 `outputs/release/0.2.0-rc.5/`：

- 已安装验证的 npm tarball：`achernar-code-0.2.0-rc.5.tgz`，SHA256 `f2b867763f750e6e91251b93479ee64e7143808e949cd5cce5c18736908880ae`。
- CLI ZIP：`achernar-code-0.2.0-rc.5.zip`，SHA256 `d9419a5a0ef528d4ad506560ac5c9152334aa3be7915345b09a0834fe0894ef1`。
- `SHA256SUMS.txt` 记录以上两份文件的校验值。

最终提交 CI `36292348821` 已全部通过。源码已快进合入独立仓库 `main`；标签 `v0.2.0-rc.5` 指向上述最终提交。标签发布验证 `36292476157` 的六组跨平台检查均通过，npm publish 作业因账号尚未配置而跳过。

GitHub 预览版已发布：[Achernar CLI 0.2.0-rc.5](https://github.com/JiuYue0820/achernar-code/releases/tag/v0.2.0-rc.5)。发布资产为 CLI `.tgz`、CLI `.zip`、SHA256SUMS、安装验证 JSON 和真实模型评测 JSON；不包含桌面版。

已从公开 Release 重新下载 `.tgz` 并确认 SHA256 与本地验证包一致；另在全新目录使用下面的公开地址完成 npm 安装，执行 `achernar --version` 返回 `0.2.0-rc.5`：

```powershell
npm install -g https://github.com/JiuYue0820/achernar-code/releases/download/v0.2.0-rc.5/achernar-code-0.2.0-rc.5.tgz
```

剩余发布步骤：维护者在本机完成 `npm login`，发布已验证的同一份 `.tgz` 至 `next` 通道，再配置 npm trusted publisher 并启用仓库发布变量。当前不能声称 `npm install -g achernar-code@next` 或注册表更新通知已公开可用。
