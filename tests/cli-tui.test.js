const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Editor, decoder } = require('../cli/tui-input');
const { width, wrap, safeText } = require('../cli/tui-text');
const { renderScreen, palette } = require('../cli/tui-screen');
const { TerminalUI } = require('../cli/tui');
const { Metrics } = require('../cli/tui-metrics');
function fixture(options = {}) {
  const input = new EventEmitter(), output = new EventEmitter(), writes = [];
  Object.assign(input, { isRaw: false, setRawMode(value) { this.isRaw = value; }, setEncoding() {}, resume() {}, pause() {} });
  Object.assign(output, { columns: 110, rows: 34, write(text) { writes.push(text); } });
  const ui = new TerminalUI({ input, output, project: 'D:\\Projects\\Example', model: 'fixture', version: '0.2.0', mode: 'execute', animate: false, onSubmit() {}, ...options });
  return { ui, input, output, writes };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('editor moves and deletes whole Chinese/emoji graphemes, including at capacity', () => {
  const editor = new Editor(); editor.insert('你好👩‍💻é'); editor.key('left'); editor.key('backspace');
  assert.equal(editor.text, '你好é'); editor.key('home'); editor.insert('A'); editor.key('end'); editor.key('backspace');
  assert.equal(editor.text, 'A你好'); assert.equal(width('A你好👩‍💻'), 7);
  editor.set('a'.repeat(19999)); editor.insert('👩‍💻'); assert.equal(editor.text.length, 19999);
  assert.equal(safeText('\x1b]0;bad title\x07hello\x1b[2J'), 'hello');
  assert.deepEqual(wrap('中英hello', 4), ['中英', 'hell', 'o']);
  assert.deepEqual(wrap('official JSON plugin.', 14), ['official JSON', 'plugin.']);
});
test('split paste is inserted as text without executing embedded commands', () => {
  const events = [], parser = decoder((name, text) => events.push({ name, text }));
  parser.feed('\x1b[20'); parser.feed('0~first\r\n/exit\n'); parser.feed('last\x1b[201'); parser.feed('~');
  assert.deepEqual(events, [{ name: 'text', text: 'first\n/exit\nlast' }]);
  parser.feed('\x1b['); parser.feed('D'); parser.feed('\x1b\r'); parser.feed('\r'); parser.dispose();
  assert.deepEqual(events.slice(1).map(e => e.name), ['left', 'newline', 'enter']);
});
test('usage is deduplicated per model round, includes child costs, excludes tool latency', () => {
  const metrics = new Metrics(); assert.equal(metrics.snapshot().total, null); metrics.begin();
  metrics.event({ type: 'round', round: 1 }, 1000);
  metrics.event({ type: 'context_usage', estimatedTokens: 150, limit: 64000 }, 1000);
  assert.equal(metrics.snapshot().estimated, true);
  metrics.event({ type: 'usage', usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }, 2000);
  metrics.event({ type: 'usage', usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 } }, 3000);
  assert.equal(metrics.snapshot().total, 140); assert.equal(metrics.snapshot().rate, 20);
  metrics.event({ type: 'round', round: 2 }, 9000);
  metrics.event({ type: 'context_usage', estimatedTokens: 190, limit: 64000 }, 9000);
  metrics.event({ type: 'usage', usage: { prompt_tokens: 180, completion_tokens: 60, total_tokens: 240 } }, 11000);
  assert.equal(metrics.snapshot().total, 380); assert.equal(metrics.snapshot().rate, 25); assert.equal(metrics.snapshot().used, 240);
  metrics.event({ type: 'subagent_event', agentId: 'a', event: { type: 'usage', usage: { total_tokens: 10 } } }, 11000);
  assert.equal(metrics.snapshot().total, 390); assert.equal(metrics.snapshot().used, 240);
  metrics.reset(); metrics.event({ type: 'usage', usage: {} }); assert.equal(metrics.snapshot().total, null);
});
test('slash menu appears above input; selecting an entry inserts and then sends it', async () => {
  const sent = [], { ui } = fixture({ onSubmit: text => sent.push(text) });
  ui.key('text', '/'); assert.equal(ui.state.menu, true);
  const frame = renderScreen(ui.state); assert.ok(frame.layout.menuTop < frame.layout.y);
  ui.editor.set('/review'); ui.refreshMenu(); ui.key('enter'); assert.equal(ui.editor.text, '/review '); assert.equal(sent.length, 0);
  ui.key('text', '认证'); ui.key('enter'); await settle(); assert.deepEqual(sent, ['/review 认证']);
  ui.key('up'); assert.equal(ui.editor.text, '/review 认证'); ui.close();
});
test('skills picker opens after local command settles; approval cancellation keeps task isolated', async () => {
  let canceled = 0, exited = 0; const { ui } = fixture({ onCancel: () => canceled++, onExit: () => exited++ });
  ui.onSubmit = () => ui.editor.set('/skill/'); ui.editor.set('/skills'); ui.key('enter'); await settle(); assert.equal(ui.state.menu, true);
  ui.state.busy = true; const approval = ui.ask('允许写文件？'); ui.key('text', 'y'); ui.key('enter'); assert.equal(await approval, 'y');
  assert.equal(ui.editor.text, '/skill/', 'answering a dialog restores the unfinished draft');
  ui.editor.set(''); ui.key('eof'); assert.equal(canceled, 1); assert.equal(exited, 0);
  ui.state.busy = false; ui.key('cancel'); assert.equal(exited, 1); ui.close();
});
test('screen stays within cells after resize, Chinese multiline edits, metrics and menus', () => {
  const { ui } = fixture();
  ui.state.metrics = { total: 13450, rate: 43.7, used: 8050, limit: 128000, estimated: false };
  for (const [cols, rows] of [[150, 45], [110, 34], [80, 24], [55, 22], [40, 18], [25, 8]]) {
    for (const value of ['', '/', '第一行\n第二行\n这是第三行中文和 English'.repeat(3)]) {
      ui.editor.set(value); ui.refreshMenu(); const frame = renderScreen(ui.state, cols, rows);
      assert.equal(frame.canvas.cells.length, rows);
      for (const line of frame.canvas.lines(false)) assert.ok(width(line) <= cols - 1, `${cols}x${rows}: ${line}`);
      if (frame.cursor) { assert.ok(frame.cursor.x < cols - 1 && frame.cursor.y < rows - 1); assert.ok(frame.layout.y + frame.layout.inputHeight + frame.layout.metricsRows < rows - 1); }
      if (frame.layout.menuTop) assert.ok(frame.layout.menuTop < frame.layout.y);
    }
  }
  ui.editor.set(''); ui.state.menu = false;
  const frame = renderScreen(ui.state, 110, 34), texts = frame.canvas.lines(false).join('\n');
  assert.match(texts, /43.7 token\/s/); assert.match(texts, /Used 13,450 tokens/); assert.match(texts, /Context 8,050 \/ 128,000/);
  assert.match(texts, /╭─+╮/); assert.ok(frame.layout.inputHeight >= 8);
  assert.equal(frame.canvas.cells[frame.layout.y + frame.layout.inputHeight - 2][frame.layout.x + 3].char, ' ');
  assert.ok(frame.canvas.lines().some(line => line.includes('\x1b[49m'))); ui.close();
});
test('raw mode, alternate screen and listeners are restored on exit', () => {
  const { ui, input, output, writes } = fixture(); ui.start(); assert.equal(input.isRaw, true); assert.equal(input.listenerCount('data'), 1);
  ui.close(); ui.close(); assert.equal(input.isRaw, false); assert.equal(input.listenerCount('data'), 0); assert.equal(output.listenerCount('resize'), 0);
  assert.match(writes.at(-1), /\x1b\[\?1049l/); assert.match(writes.at(-1), /\x1b\[\?2004l/);
});
test('modal choice can be filtered and selected by mouse without leaking into task input', async () => {
  const { ui } = fixture(); ui.state.busy = true;
  const pending = ui.choose('Select model', [{ command: 'first', value: 'first', description: 'Model A' }, { command: 'second', value: 'second', description: 'Model B' }]);
  ui.key('text', 'second'); assert.equal(ui.state.matches.length, 1); ui.draw();
  const hit = ui.frame.hitboxes.find(b => b.action === 'select'); assert.ok(hit);
  assert.equal(ui.frame.canvas.cells[0][0].bg, '#161616');
  ui.parser.feed(`\x1b[<0;${hit.x + 1};${hit.y + 1}M`); assert.equal(await pending, 'second'); assert.equal(ui.editor.text, ''); assert.equal(ui.state.picker, null); ui.close();
});
test('processing output has subtle status animation, hidden thinking, tool cards and indented text', () => {
  const { ui } = fixture(); ui.state.busy = true; ui.begin('Review project');
  ui.event({ type: 'reasoning', delta: 'Inspecting the implementation.' }); ui.event({ type: 'tool_start', name: 'files', callId: 'read', arguments: { path: 'main.js' } });
  ui.event({ type: 'tool_result', name: 'files', callId: 'read', failed: false }); ui.event({ type: 'token', delta: 'The check passed.' });
  const first = renderScreen(ui.state, 110, 40).canvas.lines(false).join('\n'); ui.state.tick = 8; const second = renderScreen(ui.state, 110, 40).canvas.lines(false).join('\n');
  assert.notEqual(first, second); assert.match(second, /Thinking · Done/); assert.doesNotMatch(second, /Inspecting the implementation/); assert.match(second, /files · main\.js · Completed/); assert.doesNotMatch(second, /✦ Achernar/);
  const lines = second.split('\n'); assert.ok(lines.find(l => l.includes('The check passed.')).indexOf('The check') > lines.find(l => l.trim() === 'Achernar').indexOf('Achernar')); ui.close();
});
test('tool cards retain hidden streaming output, support hover and independent command/output folding', () => {
  const { ui, output } = fixture(); output.rows = 48; ui.begin('List files'); ui.state.busy = true;
  ui.event({ type: 'tool_start', name: 'terminal', callId: 'shell', arguments: { command: 'Get-ChildItem' } });
  ui.event({ type: 'terminal_output', text: 'first.js\n' }); ui.draw();
  assert.equal(ui.state.logs.at(-1).expanded, false);
  assert.match(ui.frame.canvas.lines(false).join('\n'), /Get-ChildItem/);
  assert.doesNotMatch(ui.frame.canvas.lines(false).join('\n'), /first.js/);
  let hit = ui.frame.hitboxes.find(h => h.action === 'fold'); assert.ok(hit);
  ui.mouse({ button: 35, x: hit.x, y: hit.y }); assert.equal(ui.frame.canvas.cells[hit.y][hit.x].bg, '#303030');
  ui.mouse({ button: 0, down: true, x: hit.x, y: hit.y });
  hit = ui.frame.hitboxes.find(h => h.action === 'fold-output'); ui.mouse({ button: 0, down: true, x: hit.x, y: hit.y });
  assert.match(ui.frame.canvas.lines(false).join('\n'), /first.js/);
  hit = ui.frame.hitboxes.find(h => h.action === 'fold'); ui.mouse({ button: 0, down: true, x: hit.x, y: hit.y });
  assert.doesNotMatch(ui.frame.canvas.lines(false).join('\n'), /first.js/);
  ui.event({ type: 'terminal_output', text: 'second.js\n' }); ui.event({ type: 'tool_result', name: 'terminal', callId: 'shell', duration: 50, result: '{"exitCode":0}' }); ui.draw();
  assert.equal(ui.state.logs.at(-1).expanded, false);
  hit = ui.frame.hitboxes.find(h => h.action === 'fold'); ui.mouse({ button: 0, down: true, x: hit.x, y: hit.y });
  assert.match(ui.frame.canvas.lines(false).join('\n'), /first.js/); assert.match(ui.frame.canvas.lines(false).join('\n'), /second.js/);
  hit = ui.frame.hitboxes.find(h => h.action === 'fold-output'); ui.mouse({ button: 0, down: true, x: hit.x, y: hit.y });
  const text = ui.frame.canvas.lines(false).join('\n'); assert.match(text, /Get-ChildItem/); assert.doesNotMatch(text, /first.js|second.js/);
  ui.parser.feed('\x1b['); ui.parser.feed('13~'); assert.equal(ui.state.logs.at(-1).expanded, false);
  ui.parser.feed('\x1bOS'); assert.equal(ui.state.logs.at(-1).expanded, true); assert.equal(ui.state.logs.at(-1).outputExpanded, true); ui.close();
});
test('plan stays above input, updates without log duplication, folds, scrolls and resets between turns', () => {
  const { ui, output } = fixture(); ui.begin('Implement and verify'); ui.state.busy = true;
  const steps = Array.from({ length: 12 }, (_, i) => ({ text: `Step ${i + 1}: ` + 'long task detail '.repeat(10), status: i === 0 ? 'in_progress' : 'pending' }));
  ui.event({ type: 'plan', steps }); ui.draw();
  const count = ui.state.logs.length;
  ui.event({ type: 'plan', steps: steps.map((s, i) => ({ ...s, status: i === 0 ? 'completed' : i === 1 ? 'in_progress' : s.status })) });
  assert.equal(ui.state.logs.length, count);
  for (const [cols, rows] of [[110, 40], [80, 24], [40, 18], [31, 16]]) {
    output.columns = cols; output.rows = rows; ui.draw();
    const { layout, canvas, cursor } = ui.frame;
    assert.ok(layout.planTop >= 2);
    assert.ok(layout.planTop + layout.planHeight < layout.y);
    assert.ok(cursor.y >= layout.y && cursor.y < rows - 1);
    assert.match(canvas.lines(false).join('\n'), /Task plan · 1\/12/);
    for (const line of canvas.lines(false)) assert.ok(width(line) <= cols - 1);
  }
  output.columns = 110; output.rows = 40; ui.draw();
  const area = ui.frame.hitboxes.find(h => h.action === 'plan-scroll');
  const offset = ui.frame.layout.planOffset;
  ui.mouse({ button: 65, x: area.x, y: area.y });
  assert.equal(ui.frame.layout.planOffset, offset + 1);
  ui.parser.feed('\x1b[15~'); assert.equal(ui.state.plan.expanded, false);
  ui.event({ type: 'plan', steps }); assert.equal(ui.state.plan.expanded, false);
  ui.draw();
  const hit = ui.frame.hitboxes.find(h => h.action === 'fold-plan');
  ui.mouse({ button: 0, down: true, x: hit.x, y: hit.y }); assert.equal(ui.state.plan.expanded, true);
  ui.begin('Next task'); assert.equal(ui.state.plan, null);
  assert.ok(ui.state.logs.some(b => b.title === 'Task plan'));
  ui.event({ type: 'plan', steps }); ui.reset(); assert.equal(ui.state.plan, null);
  ui.close();
});
test('opening long output keeps its header reachable; narrow cards do not overflow', () => {
  const { ui } = fixture(); ui.begin('Read output'); ui.event({ type: 'tool_start', name: 'terminal', callId: 'long', arguments: { command: 'Get-ChildItem' } });
  ui.event({ type: 'terminal_output', text: Array.from({ length: 200 }, (_, i) => 'line ' + i).join('\n') }); ui.event({ type: 'tool_result', name: 'terminal', callId: 'long' }); ui.draw();
  let hit = ui.frame.hitboxes.find(h => h.action === 'fold'); ui.mouse({ button: 0, down: true, x: hit.x, y: hit.y });
  hit = ui.frame.hitboxes.find(h => h.action === 'fold-output'); ui.mouse({ button: 0, down: true, x: hit.x, y: hit.y });
  assert.ok(ui.frame.hitboxes.some(h => h.action === 'fold-output'));
  for (const [cols, rows] of [[40, 18], [55, 24], [80, 30]]) for (const line of renderScreen(ui.state, cols, rows).canvas.lines(false)) assert.ok(width(line) <= cols - 1);
  ui.close();
});
test('terminal markdown handles headings, code fences and bounded syntax spans', () => {
  const { outputLines, codeSpans } = require('../cli/tui-output');
  const lines = outputLines('## Result\n**Done**\n```js\nconst value = 42;\n```', 80);
  assert.deepEqual(lines[0], { text: 'Result', style: 'heading' }); assert.equal(lines[1].text, 'Done');
  const code = lines.find(line => line.style === 'code'); assert.ok(code); assert.ok(codeSpans(code.text).some(span => span.text === '42'));
});
test('real streamed model events reach text and usage display', async t => {
  const http = require('node:http'), { runAgent } = require('../src/services/agent');
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) { /* consume the actual model request */ }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '已检查' } }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '代码。' }, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 8, total_tokens: 128 } }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const { ui } = fixture(); t.after(() => ui.close()); ui.begin('检查代码');
  await runAgent({ host: 'cli', provider: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, modelId: 'fixture' }, project: process.cwd(), messages: [{ role: 'user', content: '检查代码' }], signal: AbortSignal.timeout(10000), emit: event => ui.event(event) });
  assert.equal(ui.metrics.snapshot().total, 128); assert.equal(ui.metrics.snapshot().estimated, false);
  assert.ok(ui.state.logs.some(block => block.kind === 'assistant' && block.text === '已检查代码。'));
});
