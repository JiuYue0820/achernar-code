# Motion Reference

## Workspace UI Libraries

`src/vendor/workspace-editor.js` bundles CodeMirror 6 and its language packages,
Lezer, crelt, style-mod, w3c-keyname and find-cluster-break under the MIT license.
Their original license texts are retained in `src/vendor/workspace-editor.LICENSE.txt`
by `npm run build:editor`. CodeMirror is Copyright (C) 2018-2021 by Marijn Haverbeke
and others. Continuous corner paths use figma-squircle 1.1.0, Copyright (c) 2021
Tien Pham (MIT). Streamed tool arguments use partial-json 0.1.7, Copyright (c) 2023
Promplate Dev Team (MIT). The latter packages retain their licenses in node_modules.


The user-requested Context7 integration connects to the official Upstash
service at https://mcp.context7.com/mcp. Its remote implementation and returned
documentation are third-party resources; only the Achernar configuration and
integration notes are maintained by this project. See https://context7.com.
Public Bing and 360 search results and npm registry metadata retain their
respective source ownership. No remote plugin implementation was vendored.

The workspace contains no imported third-party plugin or Skill packages. The
notice below covers only the separately documented motion reference used by
Achernar's own cursor implementation; it is not an installed extension.

The Bezier path selection and damped cursor rotation in
`src/services/cursor-motion.js` and `runtime/control-cursor.ps1` were informed by
`CursorMotionModel.swift` from
https://github.com/iFurySt/open-codex-computer-use at commit
`386a260d1ab8b690adbbb27f7471595cf0c2b752`.
Achernar retains its own cursor artwork and Windows UIA/Win32 workflow.

The reference project is MIT licensed:

MIT License

Copyright (c) 2026 Leo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
