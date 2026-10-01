# Achernar Computer Use

这是 Achernar 内建的 Windows 操控插件说明，不依赖第三方宿主 hooks。实现位于 `src/services/computer.js`、`src/computer-panel.js`、`runtime/windows-agent.ps1` 和控制状态指示器中。

插件先枚举窗口并截图确认，再优先使用 UI Automation / Win32 目标定位；必要时才使用坐标输入。命令和桌面控制遵循 Achernar 当前的审批模式，停止按钮与控制状态始终可见。每次操作后应再次观察界面，不能仅以输入事件已发送作为成功依据。
