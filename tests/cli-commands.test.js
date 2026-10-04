const test = require('node:test'), assert = require('node:assert/strict');
const { createChatCommands } = require('../cli/chat-commands');
const { commandCatalog, TerminalUI } = require('../cli/tui');
const { Metrics } = require('../cli/tui-metrics');
function fixture(overrides = {}) {
  let config = { modelId: '', baseUrl: 'https://api.openai.com/v1', apiFormat: 'openai-chat-completions', directories: [] }, project = process.cwd();
  const notices = [], saved = [], selections = [], answers = [], prompts = [], options = { approval: 'ask', plan: false };
  const ui = { state: { logs: [], scroll: 0 }, metrics: new Metrics(), editor: { set(value) { this.text = value; } }, refreshMenu() {}, draw() {}, context() {}, reset() { this.state.logs = []; this.metrics.reset(); }, notice: (...value) => notices.push(value), choose: async (title, entries, signal, options) => { prompts.push({ title, entries, options }); return selections.shift() || ''; }, ask: async text => { prompts.push(text); return answers.shift() || ''; } };
  const handler = createChatCommands({ ui, options, settings: () => config, saveSettings: value => { saved.push(value); config = { ...config, ...value }; }, cwd: () => project, setWorkspace: (value, dirs) => { project = value; config.directories = dirs; }, exit() {}, listSessions: () => [], loadSession: () => null, saveSession() {}, discoverModels: async () => { throw new Error('must not call network without a key'); }, ...overrides });
  return { handler, ui, notices, saved, selections, answers, prompts, options, settings: () => config };
}
test('built-in model matches its command, never an unrelated plugin description', () => {
  const ui = new TerminalUI({ project: process.cwd(), version: '0.2.0', extensions: [{ name: 'runtime-checks', kind: 'plugins', description: 'Check model directories' }] });
  ui.editor.set('/model'); ui.refreshMenu(); assert.deepEqual(ui.state.matches.map(e => e.command), ['/model']);
  for (const name of ['model', 'help', 'new', 'clear', 'sessions', 'resume', 'status', 'approval', 'provider', 'format', 'context']) assert.ok(commandCatalog().some(e => e.command === '/' + name));
  assert.ok(commandCatalog().every(e => !/[\u3400-\u9fff]/.test(e.description)));
});
test('model manual entry and provider settings persist without storing credentials', async () => {
  const f = fixture(); f.selections.push('@manual'); f.answers.push('local-coder'); await f.handler.handle('/model');
  assert.equal(f.settings().modelId, 'local-coder'); assert.equal(f.prompts[0].title, 'Select model');
  await f.handler.handle('/provider http://localhost:11434/v1'); await f.handler.handle('/format openai-responses'); await f.handler.handle('/context 131072');
  assert.equal(f.settings().baseUrl, 'http://localhost:11434/v1'); assert.equal(f.settings().apiFormat, 'openai-responses'); assert.equal(f.ui.metrics.limit, 131072);
  assert.ok(f.saved.every(s => !Object.hasOwn(s, 'apiKey')));
  await assert.rejects(f.handler.handle('/provider https://user:secret@example.com'), /without credentials/);
  await assert.rejects(f.handler.handle('/context -1'), /integer/);
});
test('discovered model choice applies context metadata; unsupported discovery allows manual entry', async () => {
  const f = fixture({ discoverModels: async () => ({ models: ['coder-small', 'coder-big'], metadata: { 'coder-big': { contextWindow: 200000 } } }) });
  await f.handler.handle('/provider http://localhost:11434/v1'); f.selections.push('@toggle-provider', 'coder-big'); await f.handler.handle('/model');
  assert.ok(!f.prompts[0].entries.some(e => e.value === 'coder-big'));
  assert.ok(f.prompts[1].entries.some(e => e.value === 'coder-big')); assert.equal(f.settings().modelId, 'coder-big'); assert.equal(f.settings().contextWindow, 200000);
});
test('configured model appears once; discovery expands and hides without selecting or refetching', async () => {
  let fetched = 0;
  const profile = { name: 'Custom · agnes-3.0-flash', modelId: 'agnes-3.0-flash', baseUrl: 'https://example.test/v1', apiFormat: 'openai-chat-completions' };
  const f = fixture({ settings: () => ({ ...profile, apiKey: 'fixture' }), library: { profiles: () => [profile] }, discoverModels: async () => { fetched++; return { models: [profile.modelId, 'agnes-2.5-pro-alpha', 'agnes-video-2.5-flash', 'agnes-2.5-pro-alpha'] }; } });
  await f.handler.handle('/model'); assert.equal(fetched, 0); assert.equal(f.saved.length, 0);
  assert.equal(f.prompts[0].entries.filter(e => e.command.includes('agnes-3.0-flash')).length, 1);
  f.selections.push('@toggle-provider', '@toggle-provider', '@toggle-provider', ''); await f.handler.handle('/model');
  assert.equal(fetched, 1); assert.equal(f.saved.length, 0);
  assert.equal(f.prompts[2].entries.filter(e => e.value === 'agnes-2.5-pro-alpha').length, 1);
  assert.ok(f.prompts[2].entries.some(e => e.command === '▾ Hide provider models'));
  assert.ok(!f.prompts[3].entries.some(e => e.value === 'agnes-2.5-pro-alpha'));
  assert.ok(f.prompts[3].entries.some(e => e.command === '▸ Show provider models'));
});
test('discovery errors preserve the configured model and restore menu status', async () => {
  const f = fixture({ discoverModels: async () => { throw new Error('offline'); } });
  await f.handler.handle('/provider http://localhost:1234/v1'); await f.handler.handle('/model local'); f.ui.state.status = 'Ready';
  f.selections.push('@toggle-provider', ''); await f.handler.handle('/model');
  assert.equal(f.settings().modelId, 'local'); assert.equal(f.ui.state.status, 'Ready'); assert.match(f.notices.at(-1)[0], /discovery failed/);
});
test('approval and plan switches are effective; clear retains session while new releases it', async () => {
  const f = fixture(); await f.handler.handle('/approval auto'); assert.equal(f.options.approval, 'ask');
  f.answers.push('yes'); await f.handler.handle('/approval auto'); assert.equal(f.options.approval, 'auto');
  await f.handler.handle('/approval ask'); assert.equal(f.options.approval, 'ask');
  await f.handler.handle('/mode plan'); assert.equal(f.options.plan, true); assert.equal(f.ui.state.mode, 'plan');
  const saved = { id: 'test', project: process.cwd(), messages: [] }; f.handler.setSession(saved);
  await f.handler.handle('/clear'); assert.equal(f.handler.getSession(), saved);
  await f.handler.handle('/new'); assert.equal(f.handler.getSession(), undefined);
  assert.equal(await f.handler.handle('/plan read code'), false); assert.equal(await f.handler.handle('ordinary task'), false);
  await assert.rejects(f.handler.handle('/typo'), /Unknown command/);
});
test('session picker restores project and history without automatically executing tasks', async () => {
  const saved = { id: 'saved-session', project: process.cwd(), messages: [{ role: 'user', content: 'prior task' }, { role: 'assistant', content: 'prior result' }] };
  const f = fixture({ listSessions: () => [saved], loadSession: () => saved }); f.selections.push(saved.id);
  await f.handler.handle('/sessions'); assert.equal(f.handler.getSession(), saved);
  assert.ok(f.notices.some(([text, kind]) => text === 'prior result' && kind === 'assistant'));
});
test('/session provides deletion with confirmation, clears deleted active session and preserves cancellation', async () => {
  const record = { id: 'fixture', project: process.cwd(), messages: [{ role: 'user', content: 'Original task' }] }; let records = [record], deleted = [];
  const f = fixture({ listSessions: () => records, deleteSession: id => { deleted.push(id); records = []; } });
  f.handler.setSession(record); f.selections.push('fixture', 'delete', 'keep', ''); await f.handler.handle('/session');
  assert.equal(deleted.length, 0); assert.equal(f.handler.getSession(), record);
  f.selections.push('fixture', 'delete', 'delete'); await f.handler.handle('/session');
  assert.deepEqual(deleted, ['fixture']); assert.equal(f.handler.getSession(), undefined);
  assert.ok(f.prompts.some(p => p.entries?.some(e => e.value === 'delete' && e.danger)));
});
test('/session exposes direct deletion, identifies its target and refreshes without changing another active session', async () => {
  const active = { id: 'active', project: process.cwd(), messages: [{ role: 'user', content: 'Active task' }] };
  const target = { id: 'delete-target', project: process.cwd(), messages: [{ role: 'user', content: 'Old task to delete' }] };
  let records = [active, target];
  const deleted = [];
  const f = fixture({ listSessions: () => records, deleteSession: id => { deleted.push(id); records = records.filter(s => s.id !== id); } });
  f.handler.setSession(active);
  f.selections.push({ action: 'delete', value: target.id }, 'delete', '');
  await f.handler.handle('/session');
  assert.deepEqual(deleted, [target.id]);
  assert.equal(f.handler.getSession(), active);
  assert.ok(f.prompts[0].options.actions.some(a => a.key === 'delete' && a.action === 'delete'));
  assert.equal(f.prompts[0].entries.find(e => e.value === target.id).editable, true);
  assert.equal(f.prompts[1].title, 'Delete this session?');
  assert.equal(f.prompts[1].entries[0].value, 'keep', 'Enter alone must not confirm deletion');
  assert.ok(f.prompts[1].options.context.includes('Old task to delete'));
  assert.ok(f.prompts[1].options.context.includes(target.id));
  assert.ok(f.prompts[1].options.context.includes('Remove history only; keep project files'));
  assert.deepEqual(f.prompts[2].entries.map(e => e.value), [active.id]);
  assert.ok(f.notices.some(([text]) => text === 'Session deleted. Project files were kept.'));
});
test('/session delete shortcut honors Escape and keeps history after a failed deletion', async () => {
  const active = { id: 'active', project: process.cwd(), messages: [{ role: 'user', content: 'Keep this task' }] };
  let attempts = 0;
  const f = fixture({ listSessions: () => [active], deleteSession: () => { attempts++; throw new Error('This session is running. Stop it before deleting.'); } });
  f.handler.setSession(active);
  f.selections.push({ action: 'delete', value: active.id }, '', '');
  await f.handler.handle('/session');
  assert.equal(attempts, 0);
  f.selections.push({ action: 'delete', value: active.id }, 'delete', '');
  await f.handler.handle('/session');
  assert.equal(attempts, 1);
  assert.equal(f.handler.getSession(), active);
  assert.ok(f.notices.some(([text, kind]) => kind === 'error' && text.includes('running')));
  assert.equal(f.prompts.at(-1).entries[0].value, active.id);
});
