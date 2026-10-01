# 内置文档工具

先 `files.write` 保存源文件，工具调用只传文件路径，避免每次重复发送整份内容。

```json
{"action":"report","source":"report.md","output":"report.html","title":"季度报告"}
```

同一源文件可导出 `report.pdf` 和 `report.docx`。HTML 包含内嵌字体、公式与图片，可离线打开。PDF 使用 A4 页边距和页码。DOCX 正文/标题/表格可编辑；公式和图片栅格化，不是 OMML。保留 report.md 以便修订。

Markdown 支持标题、强调、列表、表格、代码、引用和本地图片。公式示例：

```markdown
# 实验报告

样本均值为 $\bar{x}=\frac{1}{n}\sum_{i=1}^{n}x_i$。

$$\sigma^2=\frac{1}{n}\sum_{i=1}^{n}(x_i-\bar{x})^2$$

![每月处理量，单位：件](figures/monthly.svg)

|月份|数量|
|---|---:|
|一月|120|
|二月|156|

> 数据来源与解释局限写在图表附近。
```

图片路径相对 Markdown 文件，只接受项目内 PNG/JPEG/WebP/SVG，不联网加载。先用 web 工具读取来源；需复用图片时通过已授权的下载流程保存本地并核对许可。

当前内置模板为克制的报告样式。需要定制封面、目录、分栏、横向页面、可编辑原生公式等时，写生成脚本并通过 terminal 运行已安装的工具链；先检查版本，禁止假装装有 Word/LaTeX/Pandoc。对现有 DOCX 用 python-docx/OOXML 或 Word 编辑，对既有 PDF 使用 PyMuPDF/pypdf 等适合具体修改的库，保留原件并重新打开核对。脚本和运行错误只读相关片段，不反复把完整文件放进对话。
