// Render the very same terminal cell grid for repeatable visual inspection.
// This is a renderer preview, not a screenshot of Windows Terminal.
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright-core');
const { TerminalUI } = require('../cli/tui');
const { renderScreen } = require('../cli/tui-screen');
async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const directory = path.resolve(__dirname, '../output/playwright'); fs.mkdirSync(directory, { recursive: true });
  try {
    const page = await browser.newPage();
    const ui = new TerminalUI({ project: 'D:\\Projects\\MyProject', model: 'your-model', version: '0.2.0', mode: 'execute', animate: false });
    for (const [name, columns, rows, text, tick] of [['welcome', 110, 34, '', 0], ['orbit', 110, 34, '', 22], ['commands', 110, 34, '/', 0], ['model-command', 110, 34, '/model', 0], ['narrow', 55, 24, '/', 0], ['model-dialog', 110, 34, '', 0], ['model-dialog-narrow', 55, 24, '', 0], ['output', 110, 40, '', 7], ['tool-cards', 110, 44, '', 0], ['plan', 110, 40, '', 0], ['plan-narrow', 55, 24, '', 0], ['workbench-code', 110, 36, '', 0], ['workbench-diff', 90, 32, '', 0], ['workbench-narrow', 40, 20, '', 0], ['command-palette', 100, 34, 'files', 0], ['busy-commands-zh', 100, 36, '/', 6], ['busy-commands-ru', 100, 36, '/', 6], ['busy-commands-ja', 100, 36, '/', 6]]) {
      ui.state.question = null; ui.state.picker = null; ui.state.viewer = null; ui.state.busy = false;
      if (name.startsWith('model-dialog')) { ui.state.question = 'Select model'; ui.state.picker = { title: 'Select model', roomy: true, actions: [{key: 'edit-model', label: 'Ctrl+E Edit', action: 'edit'}, {key: 'delete', label: 'Del Delete', action: 'delete'}], entries: [{ command: 'Local coding model', value: 'local', editable: true, description: 'Saved profile · 128K context' }, { command: '+ Model ID', value: 'manual', description: 'Enter a model ID' }, { command: '+ Import models', value: 'import', description: 'Load profiles from JSON' }] }; }
      if (name === 'output') { ui.state.busy = true; ui.begin('Review the login handler and verify the fix.'); ui.event({ type: 'reasoning', delta: 'Inspect the handler, reproduce the edge case, then run its tests.' }); ui.event({ type: 'tool_start', name: 'files', callId: 'read', arguments: { path: 'src/auth/login.ts' } }); ui.event({ type: 'tool_result', name: 'files', callId: 'read', failed: false }); ui.event({ type: 'token', delta: 'The handler now rejects an expired token before opening the session.\n\nVerification\n  12 checks passed, including token expiry and invalid credentials.\n\nChanged: src/auth/login.ts' }); ui.state.status = 'Verifying'; ui.state.metrics = { total: 6248, rate: 42.6, used: 4880, limit: 128000, estimated: false }; }
      if (name === 'tool-cards') {
        ui.reset(); ui.begin('Show the files in this directory.'); ui.event({ type: 'reasoning', delta: 'Inspect the current directory using a read-only command.' });
        ui.event({ type: 'tool_start', name: 'terminal', callId: 'shell', arguments: { command: 'Get-ChildItem -Force | Select-Object Mode, Name' } });
        ui.event({ type: 'terminal_output', text: 'Mode    Name\n----    ----\nd-----  cli\nd-----  src\nd-----  tests\n-a----  package.json\n-a----  README.md' });
        ui.event({ type: 'tool_result', name: 'terminal', callId: 'shell', duration: 842, failed: false });
        const block = ui.state.logs.at(-1); block.expanded = true; block.outputExpanded = true;
        ui.event({ type: 'token', delta: 'The directory contains the CLI, application source and tests.\nProject configuration is in package.json.' });
        ui.event({ type: 'response_end', round: 0, phase: 'final' });
      }
      if (name.startsWith('plan')) {
        ui.reset(); ui.begin('Improve the task view and verify the layout.'); ui.state.busy = true;
        ui.event({ type: 'token', delta: 'The task view is updated. I am checking the layout at different terminal sizes.' });
        ui.event({ type: 'tool_start', name: 'terminal', callId: 'check', arguments: { command: 'node --test tests/cli-tui.test.js tests/cli-commands.test.js tests/cli-agent-experience.test.js' } });
        ui.event({ type: 'plan', steps: [{ text: 'Inspect the task and composer views', status: 'completed' }, { text: 'Add the plan card and compact tool summaries', status: 'completed' }, { text: 'Verify desktop and terminal layouts', status: 'in_progress' }, { text: 'Report the changes and validation', status: 'pending' }] });
        ui.state.status = 'Verifying';
      }
      if (name.startsWith('workbench')) {
        const isDiff = name === 'workbench-diff';
        ui.state.question = 'Viewer';
        ui.state.viewer = { title: isDiff ? 'Working changes · src/receipt.ts' : 'src/receipt.ts', language: isDiff ? 'diff' : 'ts', lineNumbers: !isDiff, offset: 0,
          text: isDiff ? '--- a/src/receipt.ts\n+++ b/src/receipt.ts\n@@ -1,4 +1,5 @@\n export function receipt(items: Item[]) {\n-  const total = items.reduce((sum, item) => sum + item.price, 0);\n+  const cents = items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0);\n+  const total = cents / 100;\n   return { total };\n }'
            : 'interface Item {\n  price: number;\n  quantity: number;\n}\n\n// Round each price to integer cents before accumulating.\nexport function receipt(items: Item[]) {\n  const cents = items.reduce((sum, item) => {\n    return sum + Math.round(item.price * 100) * item.quantity;\n  }, 0);\n  const count = items.reduce((sum, item) => sum + item.quantity, 0);\n  return { total: cents / 100, count };\n}\n\n// 中文注释、缩进和宽字符均保留。\n' };
      }
      if (name === 'command-palette') {
        ui.state.question = 'Command palette';
        ui.state.picker = { title: 'Command palette', entries: require('../cli/tui').commandCatalog().map(entry => ({ ...entry, value: entry.command })) };
      }
      if (name.startsWith('busy-commands')) {
        ui.reset(); ui.setLanguage(name.endsWith('zh') ? 'zh-CN' : name.endsWith('ru') ? 'ru' : 'ja');
        ui.begin('Inspect the current source and run its checks.'); ui.state.busy = true;
        ui.event({ type: 'reasoning', delta: 'Read the relevant files and verify the smallest change.' });
        ui.event({ type: 'tool_start', name: 'terminal', callId: 'checks', arguments: {command: 'node --test'} });
        ui.state.status = 'Working';
      }
      ui.editor.set(text); ui.state.tick = tick; ui.refreshMenu(); const frame = renderScreen(ui.state, columns, rows);
      await page.setViewportSize({ width: columns * 9 + 32, height: rows * 20 + 32 });
      await page.setContent('<html><body style="margin:0;background:#131313"><canvas id="terminal"></canvas></body></html>');
      await page.evaluate(({ cells, cols, rows, cursor }) => {
        const canvas = document.querySelector('canvas'); canvas.width = cols * 9 + 32; canvas.height = rows * 20 + 32;
        const context = canvas.getContext('2d'); context.font = '15px Consolas, "Microsoft YaHei", monospace'; context.textBaseline = 'middle';
        cells.forEach((row, y) => row.forEach((cell, x) => {
          context.fillStyle = cell.bg === 'default' ? '#131313' : cell.bg; context.fillRect(16 + x * 9, 16 + y * 20, 9, 20);
        }));
        cells.forEach((row, y) => row.forEach((cell, x) => {
          context.fillStyle = cell.fg;
          if (cell.char === '█') context.fillRect(16 + x * 9, 16 + y * 20, 9, 20);
          else if (cell.char === '▀' || cell.char === '▄') context.fillRect(16 + x * 9, 16 + y * 20 + (cell.char === '▄' ? 10 : 0), 9, 10);
          else context.fillText(cell.char, 16 + x * 9, 26 + y * 20);
        }));
        if (cursor) { context.fillStyle = '#ddd'; context.fillRect(16 + cursor.x * 9, 18 + cursor.y * 20, 2, 16); }
      }, { cells: frame.canvas.cells, cols: columns, rows, cursor: frame.cursor });
      await page.screenshot({ path: path.join(directory, 'cli-' + name + '.png') });
    }
    console.log('CLI cell renderer previews: ' + directory);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
