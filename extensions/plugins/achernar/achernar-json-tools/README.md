# Achernar JSON Tools

Local stdio MCP exposing json_inspect and json_format. Inputs are parsed with JSON.parse and never executed. Files are not opened or changed. Literal input is limited to 200000 characters; output previews are bounded.

Examples: json_inspect({json:'{"items":[42]}',pointer:"/items/0"}); json_inspect({json:'{"a/b":true}',pointer:"/a~1b"}); json_format({json:'{"ready":true}',indent:2}). Invalid JSON, absent keys and invalid pointer escapes return errors. Only own properties can be selected. Large values return a preview with truncated:true instead of broken JSON.

Reference: https://www.rfc-editor.org/rfc/rfc6901
