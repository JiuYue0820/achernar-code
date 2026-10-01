---
name: achernar-windows-automation
description: Use when an Achernar task must observe or control a Windows desktop application through Computer Use.
---

# Achernar Windows Automation

先枚举可见窗口并排除桌面装饰，确认目标窗口、前台状态和显示器。优先 UI Automation 或 Win32 控件定位，找不到时才使用截图坐标。每次输入前截图，输入后再次截图确认；长按、拖动和取消时必须释放按键。

所有写入和桌面操作遵循当前审批模式。使用 `runtime/windows-agent.ps1` 的结构化结果，不把坐标或窗口标题当成永久标识。目标未启动时先明确启动路径和风险，不能静默运行未知程序。
