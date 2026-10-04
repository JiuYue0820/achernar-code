# Achernar Code · 60 秒宣传动画

浏览器直接打开 `index.html` 即可播放，无需构建、无远程资源。

- 画面：16:9，1920×1080 舞台按窗口等比缩放
- 控制：空格 播放/暂停，←/→ 前后 5 秒，Home 回到开头；进度条可拖动；可关闭循环与颗粒
- `index.html?t=41500`：定格到指定毫秒，便于截图
- 系统开启"减少动态效果"时默认不自动播放

## 分镜

| 镜头 | 时间 | 画面 | 字幕 |
| --- | --- | --- | --- |
| 01 | 0–10s | 星空推近，像素恒星与 Achernar 字标逐点显现，`CODE` / 口号 / 命令依次淡入 | 一颗恒星，一个终端 |
| 02 | 10–20s | 穿越进入终端：输入 `achernar`，小恒星横幅出现；`/` 展开指令，筛选到 `/mode`，Tab 补全、Esc 关闭 | 输入 / 展开指令，管理操作不消耗 Token |
| 03 | 20–30s | Shift+Tab 循环 Code → Plan → Review → Code，F2 切换 Strict → Code，提示条同步；输入任务 | 模式与审批，一键切换 |
| 04 | 30–40s | 思考、计划卡片、`files.read` / `search` / `files.edit` 摘要与 diff | 先读后改，计划实时可见 |
| 05 | 40–48s | 终端命令审批弹窗，Allow once 后测试结果流式输出 | 关键操作，由你批准 |
| 06 | 48–60s | 回答流式输出、计划 4/4、用量统计；镜头拉远回到字标并淡出 | 交付，并说明验证结果 |

视觉语言沿用 CLI 本身：黑白中性灰、`cli/tui-art.js` 的像素恒星（此处直接移植绘制逻辑）、圆角输入框、底部 token/s 与上下文占用。终端内容是演示用的示意脚本，任务、文件名、测试数与用量均为虚构，模型名以 `your-model` 占位。

## 技术

- 所有元素由单一时间轴 `render(t)` 驱动，同一时刻始终渲染同一画面；星空与颗粒使用固定种子 `20260927`
- 星空与颗粒用 Canvas，界面用 HTML/CSS，恒星像素按种子顺序"点亮"
- 首尾帧均为空星空，循环无接缝

## 导出视频

实时录屏可直接录制浏览器窗口。需要精确帧、不掉帧时逐帧导出（使用本机 Chrome 或 Edge）：

```bash
node docs/cli-animation/export-frames.js --fps 30 --out outputs/cli-animation/frames
```

脚本结束时会打印对应的 FFmpeg 命令，例如：

```bash
ffmpeg -framerate 30 -i outputs/cli-animation/frames/frame-%05d.png -c:v libx264 -pix_fmt yuv420p -crf 18 achernar-code.mp4
```

可用 `--from` / `--to`（毫秒）只导出片段，`--no-grain` 关闭颗粒以减小视频体积。
