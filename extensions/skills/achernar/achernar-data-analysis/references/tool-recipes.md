# Vega-Lite 图表

`files.write` 保存 `charts/monthly.json`，随后调用：

```json
{"action":"chart","source":"charts/monthly.json","output":"figures/monthly.svg"}
```

源规范：

```json
{
  "$schema":"https://vega.github.io/schema/vega-lite/v6.json",
  "width":560,"height":280,
  "title":"每月处理量（件）",
  "data":{"values":[{"month":"一月","count":120},{"month":"二月","count":156}]},
  "mark":{"type":"bar","color":"#586f7c"},
  "encoding":{
    "x":{"field":"month","type":"ordinal","sort":null,"title":"月份"},
    "y":{"field":"count","type":"quantitative","title":"数量 / 件","scale":{"zero":true}},
    "tooltip":[{"field":"month"},{"field":"count"}]
  },
  "config":{"font":"Segoe UI","view":{"stroke":null},"axis":{"gridColor":"#e8e8e8"}}
}
```

line/point/area/rect/boxplot/errorband 等使用相同入口；layer/facet/concat 实现组合与多维图。源文件至多 2MB，渲染 20 秒超时；超大数据先用脚本采样/聚合并注明方法。必须内嵌数据（data.values/datasets），工具不下载 URL 或图片。SVG 是静态导出，tooltip/选择交互不会保留；需要交互则写使用 Vega/Plotly 的 HTML 并在浏览器验证。

2026-09-26 已读取官方文档 https://vega.github.io/vega-lite/docs/ ，按需访问具体 mark/encoding 页面，避免复制整本文档。统计结论来自输入数据和计算结果，不来自模板中的示例数值。
