'use strict';
// Drive the real TerminalUI through scripted states and save each rendered cell grid
// as HTML (and PNG when Chrome/Edge is available) for visual review.
// Usage: node scripts/tui-snapshot.js [outDir] [--cols 120] [--rows 40]
const path = require('node:path');
const fs = require('node:fs/promises');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { TerminalUI } = require('../cli/tui');
const { renderScreen } = require('../cli/tui-screen');

const option = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const COLS = option('cols', 120), ROWS = option('rows', 40);
const outDir = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'outputs/tui-snapshots');

function fixture() {
  const input = new EventEmitter(), output = new EventEmitter();
  Object.assign(input, { isRaw: false, setRawMode() {}, setEncoding() {}, resume() {}, pause() {} });
  Object.assign(output, { columns: COLS, rows: ROWS, write() {} });
  return new TerminalUI({ input, output, project: 'D:\\Projects\\Website', model: 'your-model', version: '0.2.0', mode: 'execute', animate: false, onSubmit() {} });
}

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
function toHtml(frame) {
  const BG = '#0c0c0c';
  const rows = frame.canvas.cells.map((row, y) => {
    let html = '', run = null;
    const flush = () => { if (run) html += `<span style="color:${run.fg};background:${run.bg}">${esc(run.text)}</span>`; run = null; };
    row.forEach((cell, x) => {
      if (cell.char === '') return; // second half of a wide glyph
      const fg = cell.fg === 'default' ? '#e6e6e6' : cell.fg, bg = cell.bg === 'default' ? BG : cell.bg;
      const isCursor = frame.cursor && frame.cursor.x === x && frame.cursor.y === y;
      if (isCursor) { flush(); html += `<span class="cur">${esc(cell.char || ' ')}</span>`; return; }
      if (!run || run.fg !== fg || run.bg !== bg) { flush(); run = { fg, bg, text: '' }; }
      run.text += cell.char;
    });
    flush();
    return `<div>${html}</div>`;
  });
  return `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:${BG}}pre{margin:0;padding:14px 16px;font:15px/20px 'Cascadia Mono',Consolas,monospace;color:#e6e6e6;white-space:pre}
pre div{height:20px}pre span{display:inline-block;height:20px;vertical-align:top}.cur{background:#e6e6e6;color:${BG}}</style><pre>${rows.join('')}</pre>`;
}

// Each scene receives a fresh UI so states do not leak between snapshots.
const SCENES = {
  welcome: () => {},
  'slash-menu': (ui) => { ui.editor.set('/'); ui.refreshMenu(); },
  running: (ui) => {
    ui.state.busy = true; ui.state.tick = 5; ui.begin('Fix the login timeout and run the related tests');
    ui.event({ type: 'round', round: 1 });
    ui.event({ type: 'reasoning', delta: 'Look at the session module first.' });
    ui.event({ type: 'plan', steps: [
      { text: 'Locate session timeout logic', status: 'completed' },
      { text: 'Patch refresh window', status: 'in_progress' },
      { text: 'Run auth tests', status: 'pending' },
      { text: 'Summarize change', status: 'pending' },
    ] });
    ui.event({ type: 'tool_start', name: 'files', callId: 'a', arguments: { action: 'read', path: 'src/auth/session.js' } });
    ui.event({ type: 'tool_result', name: 'files', callId: 'a', duration: 40, result: { content: 'x' } });
    ui.event({ type: 'tool_start', name: 'search', callId: 'b', arguments: { query: 'SESSION_TIMEOUT' } });
    ui.event({ type: 'tool_result', name: 'search', callId: 'b', duration: 120, result: { matches: [] } });
    ui.event({ type: 'tool_start', name: 'terminal', callId: 'c', arguments: { command: 'npm test -- auth' } });
    ui.event({ type: 'status', message: 'Thinking' });
    ui.event({ type: 'usage', usage: { prompt_tokens: 8000, completion_tokens: 900, total_tokens: 8900 } });
    ui.event({ type: 'context_usage', estimatedTokens: 9400, limit: 128000 });
  },
  approval: (ui) => {
    SCENES.running(ui);
    ui.state.approvalRequest = { name: 'terminal', arguments: { command: 'npm test -- auth' }, project: 'D:\\Projects\\Website' };
    ui.choose('Permission · terminal', [
      { command: 'Allow once', value: 'allow', description: 'Run this operation' },
      { command: 'Deny', value: 'deny', description: 'Skip this operation' },
      { command: 'Strict', value: 'strict', description: 'Ask for all operations' },
      { command: 'Code', value: 'code', description: 'Auto-approve code edits; ask for others' },
      { command: 'Auto', value: 'auto', description: 'Approve all operations' },
    ]).catch(() => {});
  },
  done: (ui) => {
    SCENES.running(ui);
    ui.event({ type: 'terminal_output', text: '✔ refreshes token before expiry\n✔ rejects tampered tokens\n12 passed\n' });
    ui.event({ type: 'tool_result', name: 'terminal', callId: 'c', duration: 1800, result: { exitCode: 0, stdout: '12 passed' } });
    ui.event({ type: 'plan', steps: ['Locate session timeout logic', 'Patch refresh window', 'Run auth tests', 'Summarize change'].map((text) => ({ text, status: 'completed' })) });
    ui.event({ type: 'round', round: 2 });
    ui.event({ type: 'token', delta: 'Sessions expired after 5 min because tokens were never refreshed.\n\n```js\nconst SESSION_TIMEOUT = 30 * 60 * 1000;\n```\n\nVerified: `npm test -- auth` → 12 passed.' });
    ui.event({ type: 'response_end', round: 2, phase: 'final' });
    ui.state.busy = false;
  },
};

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const only = process.argv.filter((a) => SCENES[a]);
  const files = [];
  for (const [name, setup] of Object.entries(SCENES)) {
    if (only.length && !only.includes(name)) continue;
    const ui = fixture();
    setup(ui);
    ui.state.metrics = ui.metrics.snapshot();
    const file = path.join(outDir, `${name}.html`);
    await fs.writeFile(file, toHtml(renderScreen(ui.state, COLS, ROWS)));
    files.push(file);
    ui.finishQuestion?.('');
  }
  let chromium;
  try { ({ chromium } = require('playwright-core')); } catch { return console.log(files.join('\n')); }
  let browser;
  for (const channel of ['chrome', 'msedge']) { try { browser = await chromium.launch({ channel }); break; } catch { /* next */ } }
  if (!browser) return console.log(files.join('\n'));
  try {
    const page = await browser.newPage({ viewport: { width: Math.ceil(COLS * 8.7 + 40), height: ROWS * 20 + 30 } });
    for (const file of files) {
      await page.goto(pathToFileURL(file).href);
      await page.screenshot({ path: file.replace(/\.html$/, '.png') });
    }
  } finally { await browser.close(); }
  console.log(files.map((f) => f.replace(/\.html$/, '.png')).join('\n'));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
