const test = require('node:test'), assert = require('node:assert/strict');
const { modelWizard } = require('../cli/model-wizard');
const { TerminalUI } = require('../cli/tui');
const { renderScreen } = require('../cli/tui-screen');
const { EventEmitter } = require('node:events');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
function uiFixture() {
  const input = new EventEmitter(), output = new EventEmitter(), writes = []; Object.assign(input, { setRawMode() {}, pause() {} }); Object.assign(output, { columns: 110, rows: 36, write(text) { writes.push(text); } });
  return { ui: new TerminalUI({ input, output, project: 'project', model: '', version: '0.2.0' }), writes };
}
test('model wizard preserves values on Esc back and returns full provider configuration', async () => {
  const answers = [
    { action: 'next', value: 'http://localhost:1234/v1' },
    { action: 'back', value: 'saved-draft-key' },
    { action: 'next', value: 'http://localhost:1234/v1' },
    { action: 'next', value: 'saved-draft-key' },
    { action: 'next', value: 'coder' },
    { action: 'next', value: '128000' },
    { action: 'next', value: '16384' },
  ], fields = [];
  const ui = { choose: async title => title.includes('Provider') ? 'Custom' : 'openai-chat-completions', field: async options => { fields.push(options); return answers.shift(); }, toast: text => { throw new Error(text); } };
  const model = await modelWizard(ui); assert.equal(model.providerName, 'Custom'); assert.equal(model.modelId, 'coder'); assert.equal(model.apiKey, 'saved-draft-key');
  assert.equal(fields[2].initial, 'http://localhost:1234/v1'); assert.equal(fields[3].initial, 'saved-draft-key'); assert.equal(model.contextWindow, 128000);
});
test('masked input never appears in screen bytes or logs and Esc returns its draft', async () => {
  const { ui, writes } = uiFixture(), pending = ui.field({ title: 'API Key', description: 'Enter API Key', initial: '', secret: true, allowEmpty: true });
  ui.key('text', 'fixture-secret-not-a-real-key'); ui.draw();
  assert.ok(!writes.join('').includes('fixture-secret-not-a-real-key'));
  assert.ok(!JSON.stringify(ui.state.logs).includes('fixture-secret-not-a-real-key')); assert.match(writes.join(''), /•••/);
  ui.key('escape'); assert.deepEqual(await pending, { action: 'back', value: 'fixture-secret-not-a-real-key' }); ui.close();
});
test('hover highlights choices without selecting; conversation aligns left and composer stays at bottom', async () => {
  const { ui } = uiFixture(), pending = ui.choose('Models', [{ command: 'First', value: 'a', description: '' }, { command: 'Second', value: 'b', description: '' }]);
  const target = ui.frame.hitboxes.find(h => h.index === 1); ui.parser.feed(`\x1b[<35;${target.x + 1};${target.y + 1}M`);
  assert.equal(ui.state.selected, 1); assert.ok(ui.state.picker); ui.key('enter'); assert.equal(await pending, 'b');
  ui.begin('Hello'); ui.event({ type: 'token', delta: 'Hi' }); ui.state.busy = false;
  const frame = renderScreen(ui.state, 170, 44); assert.equal(frame.layout.x, 2); assert.equal(frame.layout.areaWidth, 165);
  assert.equal(frame.layout.y + frame.layout.inputHeight + frame.layout.metricsRows, 41); assert.match(frame.canvas.lines(false)[4], /Hello/);
  assert.ok(frame.hitboxes.some(box => box.action === 'user-message')); ui.close();
});
test('Windows credential store encrypts on disk and round-trips without key in command arguments', { skip: process.platform !== 'win32' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-key-test-')), { createCredentialStore } = require('../cli/credentials');
  const store = createCredentialStore(home), key = 'fixture-key-only-12345', id = store.set('http://localhost:1234/v1', 'openai-chat-completions', key);
  const file = fs.readFileSync(path.join(home, 'credentials.json'), 'utf8'); assert.ok(!file.includes(key)); assert.match(file, /windows-dpapi-current-user/);
  assert.equal(createCredentialStore(home).get(id), key);
});
