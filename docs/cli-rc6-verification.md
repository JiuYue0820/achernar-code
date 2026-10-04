# CLI rc.6 会话删除与发布核验

日期：2026-09-27。仅修改和发布 CLI，桌面版继续测试。

## 会话删除

- `/session` 列表底部显示红色 `Del 删除`，可以点击，也支持 Delete 键；筛选后始终作用于当前选中的会话。
- 删除确认框显示会话标题、ID 和“只删除会话记录，保留项目文件”。默认选中保留，Esc 取消。
- 删除后立即刷新列表。删除当前会话时清理当前显示；删除其他会话时保留当前会话和输入草稿。
- 运行中或删除失败时不会清空当前状态；原有文件锁仍生效。
- Tips、`/shortcuts` 和中文/英文/俄语/日语提示补充删除说明。
- 将选择和删除交互提取为 `cli/session-picker.js`；确认详情支持窄终端换行。

## 已完成验证

- 先加入回归测试并确认缺失行为失败，再实现：`output/cli-session-delete-red.log`。
- CLI TUI 套件：85/85；独立包完整套件：162 项，161 通过，1 项本地 Docker 显式启用测试跳过，0 失败。
- 独立包安装后 14 项行为检查通过，包括 `session-delete` 必须确认、删除记录后保留项目文件。
- lint、format 通过。
- 已查看 100 列列表和 40 列确认框的渲染预览，确认名称、ID、说明和按钮未重叠。预览位于 `output/playwright/cli-session-*-rc6.png`，是 CLI 单元格渲染结果，不是原生终端截图。
- 本次是交互修改，没有重新调用真实模型评测；旧评测报告保持原模型、日期和源码指纹。

## 发行文件

目录：`outputs/release/0.2.0-rc.6/`。

- npm tarball：`achernar-code-0.2.0-rc.6.tgz`，SHA256 `bd1b72c582b1cad0dc180f92ea2c4139b6cc94b7dce0b2106f9db2e340acbf58`。
- CLI ZIP：`achernar-code-0.2.0-rc.6.zip`，SHA256 `426a7ca38f3ff91d7419a1b33a49e172c52d14b0926dde7697373c3b50479ba5`。
- 发布代码提交：`2a857f01f505ecc2f56facb9b96b4ca318388ff3`，对应远端 CI `36293577610`。

远端源码 CI `36293577610` 已通过六组 Windows/macOS/Linux × Node 22/24 检查和真实 Docker 检查。标签发布验证 `36293736143` 的六组检查也全部通过，npm 发布作业按配置跳过。

源码已合入 CLI 独立仓库 `main`。GitHub 预览版 [v0.2.0-rc.6](https://github.com/JiuYue0820/achernar-code/releases/tag/v0.2.0-rc.6) 已发布，附件包含 `.tgz`、`.zip`、SHA256SUMS 和验证记录。远端资产的 SHA256 与本地验证包一致。

已在全新目录通过公开 Release 地址执行 npm 安装，版本命令返回 `0.2.0-rc.6`。用户可安装：

```powershell
npm install -g https://github.com/JiuYue0820/achernar-code/releases/download/v0.2.0-rc.6/achernar-code-0.2.0-rc.6.tgz
```

## npm 状态

`npm whoami` 已成功确认登录；`npm profile get "two-factor auth"` 显示 `auth-and-writes`。直接发布被注册表以 HTTP 403 拒绝，要求本次发布的双重验证。

随后尝试官方 `npm stage publish` 上传已验证的 rc.6 包，注册表返回 HTTP 404：`Package "achernar-code" not found`。这是首次发布，暂不能走已有包的待发布流程。没有关闭或绕过账号的双重验证，也没有创建绕过 2FA 的令牌。

当前 npm 包未上线，需要账号本人完成一次发布验证；GitHub 发行不依赖这一步。下一次发布使用上面的 rc.6 tarball，不再发布旧 rc.5 包。
