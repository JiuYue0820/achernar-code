---
name: achernar-data-analysis
description: Analyze structured data and generate reproducible statistical charts, multidimensional views and validated mathematical formulas with actual plotting tools.
---

# Achernar Data Analysis

先说明数据来源、时间范围、字段含义、缺失值和单位。用结构化解析器而不是字符串猜测；统计前检查重复、异常、时区和样本量。结论区分描述性结果与因果推断，并给出可复算的筛选条件。

保留原始数据不变。关键数字至少用第二种聚合或小样本核对一次，记录无法判断的偏差。

## 图表与公式

- 趋势用折线，类别比较用柱形，分布用直方/箱线，相关用散点，矩阵用热图，多维比较优先分面与并列视图。不要为了装饰使用雷达图、立体柱或暗示因果的连线。
- 优先 `artifacts.chart`：写简短的 Vega-Lite JSON，再传源路径，得到可缩放 SVG。示例与限制见 `references/tool-recipes.md`。规模较大先在脚本中聚合，保留处理代码、随机种子与单位。高级需求用已安装的 Matplotlib/Plotly/Altair/Excel；不得假设存在，先检查版本。
- 不使用图片生成工具画分析图、坐标轴、数字或公式。图表色彩用于区分数据，选择色盲友好组合并同时用标签/线型区分；不以渐变/发光作装饰。柱图基线通常从 0 起，截断/对数轴明确说明。
- 每张图必须有可读标签、单位、来源，必要时有误差区间/样本量。查看实际 SVG/HTML/PDF，检查缺字、遮挡和裁切。数据缺失不能自动当成 0。
- 公式交给 KaTeX/LaTeX，文档使用 `achernar-documents` 工具配方。unsupported 宏必须解决或报告，不伪造成功。
