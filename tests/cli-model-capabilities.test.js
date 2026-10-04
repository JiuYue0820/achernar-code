const test = require('node:test'), assert = require('node:assert/strict');
const { modelWizard } = require('../cli/model-wizard');
const { createModelRuntime } = require('../cli/model-runtime');
const { runAgent, compactTranscript } = require('../src/services/agent-core');

test('recognized models auto-fill verified limits and supported strength without manual capacity fields', async () => {
  const answers = ['https://api.deepseek.com/v1', '', 'deepseek-flash'], fields = [];
  const ui = {
    choose: async title => title.includes('Provider') ? 'DeepSeek' : 'openai-chat-completions',
    field: async field => { fields.push(field.title); assert.ok(answers.length, 'known models must not ask for context/output limits'); return { action: 'next', value: answers.shift() }; },
    toast() {}, notice() {},
  };
  const profile = await modelWizard(ui);
  assert.equal(profile.contextWindow, 1048576);
  assert.equal(profile.maxOutputTokens, 393216);
  assert.deepEqual(profile.reasoningLevels.map(v => v.value || v), ['none', 'low', 'high', 'max']);
  assert.equal(fields.length, 3);
});
test('official model catalog distinguishes families, exact aliases and custom deployments', () => {
  const { applyCapabilities } = require('../src/model-capabilities');
  const openai = id => applyCapabilities({ baseUrl: 'https://api.openai.com/v1', modelId: id, contextWindow: 32768 });
  assert.equal(openai('gpt-5.1').contextWindow, 400000);
  assert.equal(openai('gpt-5.4-mini').maxOutputTokens, 128000);
  assert.deepEqual(openai('gpt-5.4-mini').reasoningLevels, ['none', 'low', 'medium', 'high', 'xhigh']);
  assert.equal(openai('gpt-5.5').contextWindow, 1050000);
  assert.equal(openai('gpt-5.4-fake').contextWindow, 32768);
  const custom = applyCapabilities({ baseUrl: 'http://localhost:8000', modelId: 'gpt-5.2', contextWindow: 8000, maxOutputTokens: 1000 });
  assert.equal(custom.contextWindow, 8000);
});
test('runtime accepts official DeepSeek output capacity and respects a smaller explicit cap', async () => {
  const primary = { baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash' };
  const runtime = createModelRuntime({ primary, maxOutputTokens: 393216 });
  let request;
  await runtime.provider.chatController.stream(runtime.provider, [{ role: 'user', content: 'hello' }], { maxTokens: 512 }, async (_p, _m, opts) => { request = opts; return { content: 'ok' }; });
  assert.equal(request.maxTokens, 512);
});
test('truncated output continues automatically; incomplete tool calls never execute', async t => {
  const original = global.fetch, requests = [], events = [], calls = [];
  global.fetch = async (_url, opts) => {
    requests.push(JSON.parse(opts.body));
    const first = requests.length === 1;
    return new Response(JSON.stringify({ choices: [{
      finish_reason: first ? 'length' : 'stop',
      message: first ? { content: 'Starting', tool_calls: [{ id: 'broken', type: 'function', function: { name: 'files', arguments: '{"action":"write"' } }] } : { content: 'Finished and verified' },
    }] }), { headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { global.fetch = original; });
  const result = await runAgent({ provider: { baseUrl: 'https://fixture.invalid', modelId: 'custom' }, messages: [{ role: 'user', content: 'Please continue' }], tools: { definitions: [], execute: (...args) => calls.push(args) }, signal: AbortSignal.timeout(2000), emit: e => events.push(e) });
  assert.equal(requests.length, 2);
  assert.equal(calls.length, 0);
  assert.equal(result.finalContent, 'Finished and verified');
  assert.ok(events.some(e => e.type === 'output_continuation'));
});
test('automatic output continuation is bounded rather than an infinite billable loop', async t => {
  const original = global.fetch; let calls = 0;
  global.fetch = async () => { calls++; return new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }), { headers: { 'content-type': 'application/json' } }); };
  t.after(() => { global.fetch = original; });
  await assert.rejects(runAgent({ provider: { baseUrl: 'https://fixture.invalid', modelId: 'custom' }, messages: [{ role: 'user', content: 'task' }], signal: AbortSignal.timeout(2000), emit() {} }), { code: 'MODEL_OUTPUT_LIMIT' });
  assert.equal(calls, 4);
});
test('automatic context compression reserves output space and keeps the user request', async () => {
  const transcript = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'Keep my task' }, { role: 'assistant', content: 'Old progress '.repeat(1500) }];
  const value = await compactTranscript(transcript, { contextWindow: 16000, maxOutputTokens: 8000 }, null, [], AbortSignal.timeout(1000), () => {});
  assert.notEqual(value, transcript);
  assert.ok(value.some(m => m.content === 'Keep my task'));
});
test('switching away from a known model clears its capacity instead of leaking it to a custom model', () => {
  const { forModel } = require('../src/model-capabilities');
  const prior = { baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash', contextWindow: 1048576, maxOutputTokens: 393216, maxInputTokens: 1048575, capabilitySource: 'official', limitsMode: 'auto' };
  const next = forModel(prior, { modelId: 'custom', baseUrl: 'http://localhost:8080' });
  assert.equal(next.contextWindow, 32768);
  assert.equal(next.maxOutputTokens, 16384);
  assert.equal(next.capabilitySource, undefined);
  assert.equal(forModel(prior, { modelId: 'custom', contextWindow: 90000, maxOutputTokens: 20000 }).contextWindow, 90000);
});
test('compression shrinks old reasoning and preserves denied tool pairs', async () => {
  const transcript = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'Do not delete anything' },
    { role: 'assistant', content: '', reasoning_content: 'thought '.repeat(9000), tool_calls: [{ id: 'denied', type: 'function', function: { name: 'files', arguments: '{"action":"delete","path":"keep"}' } }] },
    { role: 'tool', tool_call_id: 'denied', content: '{"denied":true}' }];
  const result = await compactTranscript(transcript, { contextWindow: 16000, maxOutputTokens: 8000 }, null, [], AbortSignal.timeout(1000), () => {});
  assert.ok(JSON.stringify(result).length < 15000);
  assert.ok(result.some(m => m.tool_call_id === 'denied'));
  assert.ok(result.some(m => m.content === 'Do not delete anything'));
});
test('a disconnected stream or blocked response never reports successful task completion', async t => {
  const original = global.fetch, events = [];
  t.after(() => { global.fetch = original; });
  const options = { provider: { baseUrl: 'https://fixture.invalid', modelId: 'custom' }, messages: [{ role: 'user', content: 'task' }], signal: AbortSignal.timeout(1000), emit: e => events.push(e) };
  global.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"unfinished"}}]}\n\n', { headers: { 'content-type': 'text/event-stream' } });
  await assert.rejects(runAgent(options), { code: 'PROVIDER_STREAM_INCOMPLETE' });
  global.fetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'content_filter', message: { content: 'partial' } }] }), { headers: { 'content-type': 'application/json' } });
  await assert.rejects(runAgent(options), { code: 'MODEL_RESPONSE_BLOCKED' });
  assert.ok(!events.some(e => e.type === 'response_end' && e.phase === 'final'));
});
test('selecting a legacy saved model refreshes limits instead of restoring its old 4096 cap', () => {
  const { saveSettings } = require('../cli/settings-save');
  const current = { baseUrl: 'https://api.deepseek.com', apiFormat: 'openai-chat-completions', modelId: 'deepseek-flash', contextWindow: 1048576, maxOutputTokens: 393216 };
  let saved;
  saveSettings({ ...current, contextWindow: 32768, maxOutputTokens: 4096 }, {
    settings: () => current, config: () => current, configPath: 'unused',
    write: (_file, value) => { saved = value; }, program: { setOptionValue() {} }, credentials: {},
  });
  assert.equal(saved.contextWindow, 1048576);
  assert.equal(saved.maxOutputTokens, 393216);
});
test('editing an existing connection preserves its selected reasoning strength', async () => {
  const current = { providerName: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiFormat: 'openai-chat-completions', modelId: 'deepseek-flash', reasoningLevel: 'max' };
  const values = [current.baseUrl, '', current.modelId];
  const profile = await modelWizard({
    choose: async title => title.includes('Provider') ? 'DeepSeek' : current.apiFormat,
    field: async () => ({ action: 'next', value: values.shift() }), toast() {}, notice() {},
  }, current, true);
  assert.equal(profile.reasoningLevel, 'max');
});
