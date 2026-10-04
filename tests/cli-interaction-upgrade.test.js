const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), { EventEmitter } = require('node:events');
const { TerminalUI } = require('../cli/tui');
function terminal(extra = {}) {
  return new TerminalUI({ input: Object.assign(new EventEmitter(), { setRawMode() {}, pause() {} }),
    output: Object.assign(new EventEmitter(), { columns: 100, rows: 36, write() {} }), project: '.', version: 'test', animate: false, ...extra });
}
async function workspace(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'achernar-interaction-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
test('model picker shortcuts target the highlighted saved row and restore the draft', async () => {
  const ui = terminal(); ui.editor.set('draft');
  const pending = ui.choose('Select model', [{ value: 'one', command: 'One', editable: true }, { value: '@add', command: 'Add' }], undefined,
    { roomy: true, actions: [{ key: 'edit-model', label: 'Ctrl+E Edit', action: 'edit' }, { key: 'delete', label: 'Del Delete', action: 'delete' }] });
  ui.key('down'); ui.key('delete'); assert.ok(ui.state.picker, 'actions must not delete synthetic menu rows');
  ui.key('up'); ui.parser.feed('\x05');
  assert.deepEqual(await pending, { action: 'edit', value: 'one' }); assert.equal(ui.editor.text, 'draft'); ui.close();
});
test('editing a saved inactive model changes only that profile; deletion honors confirmation', async t => {
  const root = await workspace(t), library = require('../cli/library').createCliLibrary(path.resolve(__dirname, '..'), root);
  const a = { modelId: 'active', baseUrl: 'https://a.invalid', apiFormat: 'openai-chat-completions' }, b = { ...a, modelId: 'other' };
  library.saveProfile(a); library.saveProfile(b); let current = a; const picks = ['reasoning', 'high', 'keep', 'delete'];
  const ctx = { library, settings: () => current, saveSettings: patch => current = { ...current, ...patch }, refresh() {}, ui: { choose: async () => picks.shift(), notice() {} } };
  const { modelAction } = require('../cli/model-actions');
  await modelAction('edit', b, ctx);
  assert.equal(library.profiles().find(p => p.modelId === 'other').reasoningLevel, 'high'); assert.equal(current.reasoningLevel, undefined);
  await modelAction('delete', b, ctx); assert.equal(library.profiles().length, 2);
  await modelAction('delete', b, ctx); assert.equal(library.profiles().length, 1); assert.equal(current.modelId, 'active');
});
test('clickable user panels have no role title; busy orbit changes over time', () => {
  const ui = terminal(); ui.begin('User text'); ui.state.busy = true;
  const { renderScreen } = require('../cli/tui-screen');
  const first = renderScreen(ui.state, 100, 36);
  assert.ok(first.hitboxes.some(b => b.action === 'user-message'));
  assert.doesNotMatch(first.canvas.lines(false).join('\n'), /(?:^|\n)\s*(?:You|你)\s*(?:\n|$)/);
  assert.ok(first.canvas.cells.some(row => row.some(cell => cell.bg === '#292929')));
  ui.state.tick = 5; assert.notDeepEqual(renderScreen(ui.state, 100, 36).canvas.cells, first.canvas.cells); ui.close();
});
test('drag selection remains stable during streaming and Ctrl+C copies instead of canceling', async () => {
  let copied, canceled = 0;
  const ui = terminal({ copyText: async text => { copied = text; }, onCancel: () => canceled++ });
  ui.begin('abcdef'); ui.draw();
  const target = ui.frame.hitboxes.find(b => b.action === 'user-message' && ui.frame.canvas.cells[b.y].some(c => c.char === 'a'));
  const x = ui.frame.canvas.cells[target.y].findIndex(c => c.char === 'a');
  ui.mouse({ button: 0, down: true, x, y: target.y });
  ui.mouse({ button: 32, down: true, x: x + 5, y: target.y });
  ui.mouse({ button: 0, down: false, x: x + 5, y: target.y });
  ui.event({ type: 'token', delta: 'Streaming output while selected' }); ui.state.tick += 6; ui.draw();
  assert.ok(!ui.frame.canvas.lines(false).join('\n').includes('Streaming output while selected'));
  ui.key('cancel'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(copied, 'abcdef'); assert.equal(canceled, 0);
  ui.key('escape'); ui.draw(); assert.match(ui.frame.canvas.lines(false).join('\n'), /Streaming output while selected/); ui.close();
});
test('running tasks keep command suggestions and can change next-task settings without clearing busy state', async () => {
  const commands = [], ui = terminal({ onSubmit: command => commands.push(command) });
  ui.state.busy = true; ui.key('text', '/reason');
  assert.ok(ui.state.menu); assert.ok(ui.frame.hitboxes.some(box => box.action === 'select'));
  ui.key('enter'); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(commands, ['/reasoning']); assert.equal(ui.state.busy, true); ui.close();
});
test('custom shortcuts persist, avoid collisions, and invoke rewind without sending user text', async () => {
  const shortcuts = require('../cli/shortcuts'), commands = [];
  const config = shortcuts.bind({}, 'undo-task', 'F6'), ui = terminal({ shortcuts: config, onSubmit: command => commands.push(command) });
  ui.editor.set('unsent draft'); ui.parser.feed('\x1b[17~'); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(commands, ['/undo']); assert.equal(ui.editor.text, 'unsent draft');
  const collided = shortcuts.bind(config, 'palette', 'F6');
  assert.equal(collided['undo-task'], ''); assert.equal(collided.palette, 'F6'); ui.close();
});
test('composer shortcut hints follow customized approval and mode keys', () => {
  const ui = terminal({ shortcuts: { 'cycle-approval': 'F6', 'cycle-mode': 'F7' } });
  const text = require('../cli/tui-screen').renderScreen(ui.state, 120, 36).canvas.lines(false).join('\n');
  assert.match(text, /\[F6\]/); assert.match(text, /\[F7\]/);
  assert.doesNotMatch(text, /\[F2\]|\[S-Tab\]/); ui.close();
});
test('session delete action is clickable and confirmation shows its target without overlapping choices', async () => {
  const ui = terminal({ language: 'zh-CN' });
  ui.editor.set('unsent draft');
  const pending = ui.choose('Sessions', [{ value: 'other', command: 'Current conversation', editable: true }, { value: 'session-a', command: 'Old conversation', editable: true }], undefined,
    { actions: [{ key: 'delete', label: 'Del Delete', action: 'delete', danger: true }] });
  ui.key('text', 'old');
  assert.deepEqual(ui.state.matches.map(entry => entry.value), ['session-a']);
  const hit = ui.frame.hitboxes.find(b => b.action === 'picker-action' && b.value === 'delete');
  assert.ok(hit);
  ui.mouse({ button: 0, down: true, x: hit.x, y: hit.y });
  assert.deepEqual(await pending, { action: 'delete', value: 'session-a' });
  assert.equal(ui.editor.text, 'unsent draft');
  const confirmation = ui.choose('Delete this session?', [
    { value: 'keep', command: 'Keep session' }, { value: 'delete', command: 'Delete session', danger: true },
  ], undefined, { context: ['Old conversation', 'a2cb6b9c-c911-460d-ae36-e2697e5efaa6', '仅删除会话记录，项目文件会保留。'] });
  for (const [columns, rows] of [[100, 36], [55, 24], [40, 20]]) {
    const frame = require('../cli/tui-screen').renderScreen(ui.state, columns, rows);
    const text = frame.canvas.lines(false).join('\n');
    assert.match(text, /Old conversation/);
    assert.match(text, /仅删除会话记录/);
    assert.match(text, /保留会话/);
    const choices = frame.hitboxes.filter(b => b.action === 'select');
    const contextRow = frame.canvas.lines(false).findIndex(line => line.includes('Old conversation'));
    assert.ok(choices.every(b => b.y > contextRow && b.y < rows));
  }
  ui.key('escape'); assert.equal(await confirmation, ''); assert.equal(ui.editor.text, 'unsent draft'); ui.close();
});
test('session deletion is discoverable in rotating Tips and translated shortcut help', async () => {
  const shortcuts = require('../cli/shortcuts'), { translate } = require('../cli/i18n');
  assert.ok(shortcuts.tips().some(tip => tip.startsWith('/session') && tip.includes('Del')));
  for (const locale of ['zh-CN', 'ru', 'ja']) {
    for (const text of ['/session · Del delete selected session', 'Delete highlighted session (confirmation required)', 'Remove history only; keep project files']) {
      assert.notEqual(translate(locale, text), text, locale + ': ' + text);
    }
  }
  let help;
  const picks = ['@fixed', ''];
  await shortcuts.configureShortcuts({ settings: () => ({}), saveSettings() {}, ui: {
    state: { language: 'en' }, choose: async () => picks.shift(), view: async (_title, text) => { help = text; },
  } });
  assert.match(help, /Del.*session.*confirmation/i);
});
