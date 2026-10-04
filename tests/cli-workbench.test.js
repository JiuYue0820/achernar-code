const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { TerminalUI, commandCatalog } = require('../cli/tui');
const { Editor } = require('../cli/tui-input');
const { renderScreen } = require('../cli/tui-screen');
function terminal() {
  const input = Object.assign(new EventEmitter(), { setRawMode() {}, pause() {}, resume() {}, setEncoding() {} });
  const output = Object.assign(new EventEmitter(), { columns: 100, rows: 32, write() {} });
  return new TerminalUI({ input, output, project: '.', version: 'test', animate: false, onSubmit() {} });
}
test('multiline editor preserves display column across CJK, short lines and word deletion', () => {
  const e = new Editor(); e.set('abcde\n中\n123456'); e.cursor = 4;
  e.key('down'); assert.equal(e.cursor, 7);
  e.key('down'); assert.equal(e.cursor, 12);
  e.key('up'); e.key('up'); assert.equal(e.cursor, 4);
  e.set('const answer = value'); e.key('delete-word'); assert.equal(e.text, 'const answer = ');
  e.key('word-left'); assert.equal(e.cursor, 13);
});
test('dialogs restore unfinished input and cursor on selection, cancellation and abort', async () => {
  const ui = terminal(); ui.editor.set('unfinished\ncode'); ui.editor.cursor = 3;
  let pending = ui.choose('Models', [{ command: 'Local', description: '', value: 'local' }]);
  ui.key('enter'); assert.equal(await pending, 'local'); assert.equal(ui.editor.text, 'unfinished\ncode'); assert.equal(ui.editor.cursor, 3);
  pending = ui.ask('Path?'); ui.key('text', 'ignored'); ui.key('escape'); assert.equal(await pending, '');
  assert.equal(ui.editor.text, 'unfinished\ncode');
  const controller = new AbortController(); pending = ui.choose('Abort', [], controller.signal);
  controller.abort(new Error('cancel fixture')); await assert.rejects(pending, /cancel fixture/);
  assert.equal(ui.editor.text, 'unfinished\ncode'); ui.close();
});
test('viewer scrolls within a modal, returns to the draft and stays inside small terminals', async () => {
  const ui = terminal(); ui.editor.set('draft');
  assert.equal(typeof ui.view, 'function');
  const pending = ui.view('src/main.js', Array.from({ length: 100 }, (_, i) => `const value${i} = ${i};`).join('\n'), { language: 'js', lineNumbers: true });
  ui.key('pagedown'); assert.ok(ui.state.viewer.offset > 0);
  for (const [columns, rows] of [[100, 32], [55, 22], [35, 18]]) {
    const frame = renderScreen(ui.state, columns, rows);
    assert.ok(frame.hitboxes.some(box => box.action === 'viewer-scroll'));
    assert.ok(frame.canvas.lines(false).join('\n').includes('src/main.js'));
  }
  ui.key('escape'); await pending; assert.equal(ui.editor.text, 'draft'); ui.close();
});
test('essential capabilities are discoverable and a command palette preserves canceled drafts', async () => {
  for (const name of ['commands', 'files', 'search', 'git', 'diff', 'doctor', 'cost', 'output', 'agents', 'output-limit', 'stop']) {
    assert.ok(commandCatalog().some(entry => entry.command === '/' + name), name);
  }
  const ui = terminal(); ui.editor.set('unfinished');
  ui.key('palette'); assert.equal(ui.state.picker?.title, 'Command palette');
  ui.key('text', 'diagnostic'); assert.ok(ui.state.matches.some(entry => entry.command === '/doctor'));
  ui.key('escape'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.editor.text, 'unfinished'); ui.close();
});
test('picker search ranks the exact command above matches found only in descriptions', async () => {
  const ui = terminal();
  const pending = ui.choose('Command palette', [
    { command: '/plan', description: 'Analyze without modifying files', value: '/plan' },
    { command: '/files', description: 'Browse project source', value: '/files' },
    { command: '/files-extra', description: 'Extra file actions', value: '/files-extra' },
  ]);
  ui.key('text', 'files');
  assert.deepEqual(ui.state.matches.map(entry => entry.command), ['/files', '/files-extra', '/plan']);
  ui.key('enter');
  assert.equal(await pending, '/files');
  ui.close();
});
test('read-only file viewer and search work without invoking a model and refuse paths outside project', async t => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'achernar-workbench-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'sample.ts'), 'const answer: number = 42;\n');
  const views = [], ui = { view: async (...args) => views.push(args), ask: async () => '', choose: async () => '', notice() {} };
  const { createWorkbenchCommands } = require('../cli/workbench-commands');
  const commands = createWorkbenchCommands({ ui, cwd: () => root, settings: () => ({}), options: {}, saveSettings() {} });
  await commands.handle('/files sample.ts'); assert.match(views[0][1], /answer: number/);
  await assert.rejects(commands.handle('/files ../outside.txt'), /项目|路径|scope|project/i);
  await commands.handle('/search answer'); assert.match(views.at(-1)[1], /sample.ts:1/);
});
test('code output preserves indentation and tool results present content without escaped JSON', () => {
  const { outputLines, formatToolResult } = require('../cli/tui-output');
  const code = outputLines('```ts\n    const x = "a";\n```', 70).find(line => line.style === 'code');
  assert.ok(code.text.includes('    const x')); assert.equal(code.number, 1);
  assert.equal(formatToolResult('files', JSON.stringify({ content: 'first\nsecond', revision: 'abc' })), 'first\nsecond');
  assert.match(formatToolResult('terminal', JSON.stringify({ exitCode: 2, stdout: 'before', stderr: 'failure' })), /Exit 2[\s\S]*before[\s\S]*failure/);
});
