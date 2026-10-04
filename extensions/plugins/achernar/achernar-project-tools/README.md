# Achernar Project Tools

Achernar 自有的只读项目 MCP 插件，提供：

- `project_overview`：统计目录、文件和体积，并列出根目录条目。
- `search_project`：按纯文本搜索源文件，返回相对路径、行号和上下文。
- `read_project_file`：在项目边界内读取一个文本文件。

插件根目录由导入器通过 `${appRoot}` 注入，不接受越界路径，不跟随符号链接，并默认排除 `.git`、`node_modules`、构建产物、缓存和日志目录。三个工具均不写文件、不执行命令。

在“插件与 Skills > MCP 列表”中读取插件配置并启用 `Achernar Project Tools / project-tools` 后使用。
