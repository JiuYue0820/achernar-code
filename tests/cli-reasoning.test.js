const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const reasoning = require('../src/reasoning');
async function workspace(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'achernar-reasoning-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
test('reasoning selection validates custom API values and model switches do not inherit unrelated options', () => {
  const current = { modelId: 'one', baseUrl: 'https://example.invalid/v1', apiFormat: 'openai-chat-completions', reasoningMode: 'custom', reasoningOptions: [{ label: 'Deep work', value: 'very_deep' }], reasoningLevel: 'very_deep' };
  assert.equal(reasoning.select(current, 'very_deep').reasoningLevel, 'very_deep');
  assert.throws(() => reasoning.select(current, 'high'), /supported|configured/i);
  assert.equal(reasoning.select(current, 'default').reasoningLevel, '');
  assert.equal(reasoning.forModel(current, { modelId: 'two' }).reasoningLevel, '');
  assert.equal(reasoning.forModel(current, { modelId: 'two' }).reasoningOptions.length, 0);
  assert.equal(reasoning.forModel(current, { contextWindow: 100000 }).reasoningLevel, 'very_deep');
  assert.deepEqual(reasoning.supported({ baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash' }).map(o => o.value), ['none', 'low', 'high', 'max']);
});
test('model JSON import preserves custom reasoning labels and selected effort', async t => {
  const root = await workspace(t), file = path.join(root, 'models.json');
  await fs.writeFile(file, JSON.stringify([{ modelId: 'coder', baseUrl: 'https://example.invalid/v1', reasoningMode: 'custom', reasoningOptions: [{ label: 'Deep work', value: 'very_deep' }], reasoningLevel: 'very_deep' }]));
  const library = require('../cli/library').createCliLibrary(path.resolve(__dirname, '..'), root);
  const profile = library.importModels(file)[0];
  assert.equal(profile.reasoningLevel, 'very_deep');
  assert.equal(library.profiles()[0].reasoningOptions[0].label, 'Deep work');
});
test('reasoning TUI selection persists to the active model profile and cancellation makes no changes', async () => {
  const { configureReasoning } = require('../cli/reasoning-menu');
  let current = { modelId: 'test', baseUrl: 'https://example.invalid/v1', apiFormat: 'openai-chat-completions' }, saved;
  const context = { settings: () => current, saveSettings: change => { current = { ...current, ...change }; }, library: { profiles: () => [], saveProfile: p => { saved = p; } }, ui: { choose: async () => 'high', notice() {} } };
  await configureReasoning('', context);
  assert.equal(current.reasoningLevel, 'high'); assert.equal(saved.reasoningLevel, 'high');
  context.ui.choose = async () => ''; saved = null;
  await configureReasoning('', context); assert.equal(saved, null);
});
test('noninteractive reasoning command persists custom choices; one-run override does not change saved effort', async t => {
  const root = await workspace(t), { spawnSync } = require('node:child_process');
  await fs.writeFile(path.join(root, 'config.json'), JSON.stringify({ modelId: 'fixture', baseUrl: 'https://example.invalid/v1' }));
  const optionsFile = path.join(root, 'levels.json');
  await fs.writeFile(optionsFile, JSON.stringify([{ label: 'Deep work', value: 'very_deep' }]));
  const cli = args => {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../cli/index.js'), '--json', ...args], { windowsHide: true, encoding: 'utf8', timeout: 10000, env: { ...process.env, ACHERNAR_CLI_HOME: root } });
    assert.equal(result.status, 0, result.stdout + result.stderr); return JSON.parse(result.stdout).data;
  };
  const result = cli(['reasoning', 'very_deep', '--mode', 'custom', '--options-file', optionsFile]);
  assert.equal(result.reasoningLevel, 'very_deep');
  assert.equal(cli(['--reasoning', 'default', 'config', 'show']).reasoningLevel, '');
  assert.equal(cli(['reasoning']).reasoningLevel, 'very_deep');
});
test('DeepSeek effort maps thinking mode and repairs legacy assistant history without mutating it', async t => {
  const original = global.fetch, requests = [];
  global.fetch = async (url, opts) => { requests.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { headers: { 'content-type': 'application/json' } }); };
  t.after(() => { global.fetch = original; });
  const { streamChat } = require('../src/services/providers');
  const messages = [{ role: 'assistant', content: 'Prior result' }, { role: 'assistant', content: null, reasoning_content: 'fixture thought', tool_calls: [] }, { role: 'user', content: 'Continue' }];
  for (const level of ['none', 'high']) await streamChat({ modelId: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', reasoningLevel: level }, messages);
  assert.equal(requests[0].thinking.type, 'disabled'); assert.equal(requests[0].reasoning_effort, undefined);
  assert.equal(requests[1].thinking.type, 'enabled'); assert.equal(requests[1].reasoning_effort, 'high');
  assert.equal(requests[1].messages[0].reasoning_content, '');
  assert.equal(requests[1].messages[1].reasoning_content, 'fixture thought');
  assert.equal(messages[0].reasoning_content, undefined);
});
test('real eval subprocess sends configured custom effort and output limit, and records both', { timeout: 20000 }, async t => {
  const root = await workspace(t), http = require('node:http'), received = [];
  const task = require('../cli/eval/tasks').tasks.find(t => t.id === 'json-repair'); let step = 0;
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk; received.push(JSON.parse(text));
    const calls = task.steps[step++];
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: calls ? { tool_calls: calls } : { content: 'Done' }, finish_reason: calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const report = await require('../cli/eval').main(['node', 'eval', '--live', '--task', task.id, '--out', path.join(root, 'run'), '--max-output-tokens', '3072'], {
    setup: { modelId: 'fixture', baseUrl: `http://127.0.0.1:${server.address().port}`, reasoningMode: 'custom', reasoningOptions: [{ label: 'Deep', value: 'very_deep' }], reasoningLevel: 'very_deep' }, log() {},
  });
  assert.equal(report.passed, 1); assert.ok(received.length >= 2);
  for (const req of received) { assert.equal(req.reasoning_effort, 'very_deep'); assert.equal(req.max_tokens, 3072); }
  assert.equal(report.reasoning.reasoningLevel, 'very_deep'); assert.equal(report.results[0].reasoningLevel, 'very_deep'); assert.equal(report.maxOutputTokens, 3072);
});
