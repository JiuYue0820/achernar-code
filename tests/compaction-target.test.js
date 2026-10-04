const test = require('node:test'), assert = require('node:assert/strict');
const { runAgent, compactTranscript, contextLimit, estimateTokens } = require('../src/services/agent-core');

test('compaction threshold reserves output space and matches what the UI is told', () => {
  assert.equal(contextLimit({ contextWindow: 16000, maxOutputTokens: 8000 }), 7200);
  assert.equal(contextLimit({ contextWindow: 128000, maxOutputTokens: 32000 }), 93952);
  assert.equal(contextLimit({}), 24576);
});

test('compaction targets headroom instead of stopping at the threshold', async () => {
  const provider = { contextWindow: 16000, maxOutputTokens: 8000 };
  const transcript = [
    { role: 'system', content: 'rules '.repeat(1200) },
    { role: 'user', content: 'Task description.' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'run', type: 'function', function: { name: 'terminal', arguments: '{"command":"npm test"}' } }] },
    { role: 'tool', tool_call_id: 'run', content: 'x'.repeat(20000) },
  ];
  const result = await compactTranscript(transcript, provider, null, [], AbortSignal.timeout(1000), () => {});
  assert.equal(result.find(m => m.role === 'user').content, 'Task description.');
  assert.ok(estimateTokens(result) <= Math.floor(contextLimit(provider) * .6), 'must leave 40% headroom instead of only dipping under the limit');
});

test('completed tool arguments are shortened in place, stay valid JSON and keep their pair', async () => {
  const provider = { contextWindow: 4096, maxOutputTokens: 1024 };
  const transcript = [
    { role: 'system', content: 'rules' },
    { role: 'user', content: 'Write the file and verify.' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'w1', type: 'function', function: { name: 'files', arguments: JSON.stringify({ action: 'write', path: 'src/big.ts', content: 'C'.repeat(30000) }) } }] },
    { role: 'tool', tool_call_id: 'w1', content: '{"written":true}' },
  ];
  const result = await compactTranscript(transcript, provider, null, [], AbortSignal.timeout(1000), () => {});
  const call = result.flatMap(m => m.tool_calls || []).find(item => item.id === 'w1');
  assert.ok(call, 'a completed pair is kept because its arguments now fit');
  const args = JSON.parse(call.function.arguments);
  assert.equal(args.path, 'src/big.ts');
  assert.ok(args.content.length < 30000);
  assert.ok(result.some(m => m.tool_call_id === 'w1'));
  assert.ok(estimateTokens(result) <= Math.floor(contextLimit(provider) * .6));
});

test('an uncompactable request between the target and the limit is kept, not rejected', async () => {
  const provider = { contextWindow: 4096, maxOutputTokens: 1024 };
  const transcript = [
    { role: 'system', content: 'r'.repeat(5000) },
    { role: 'user', content: 'Task' },
    { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'terminal', arguments: '{"command":"ls"}' } }] },
    { role: 'tool', tool_call_id: 't1', content: 'y'.repeat(20000) },
  ];
  const result = await compactTranscript(transcript, provider, null, [], AbortSignal.timeout(1000), () => {});
  assert.ok(result.some(m => m.role === 'system' && m.content.length === 5000));
  assert.ok(result.some(m => m.role === 'user' && m.content === 'Task'));
  assert.ok(estimateTokens(result) <= contextLimit(provider));
});

test('context_usage reports the compaction threshold rather than the raw window', async t => {
  const events = [], original = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'done' } }] }), { headers: { 'content-type': 'application/json' } });
  t.after(() => { global.fetch = original; });
  await runAgent({ provider: { baseUrl: 'https://fixture.invalid', modelId: 'custom', contextWindow: 16000, maxOutputTokens: 8000 }, messages: [{ role: 'user', content: 'task' }], signal: AbortSignal.timeout(2000), emit: event => events.push(event) });
  const usage = events.find(event => event.type === 'context_usage');
  assert.equal(usage.limit, 7200);
});
