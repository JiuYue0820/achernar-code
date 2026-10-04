const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http');
const { streamChat } = require('../src/services/providers');
const api = (() => { try { return require('../cli/model-runtime'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; return {}; } })();
async function endpoint(t, handler) {
  const server = http.createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}/v1`;
}
const response = (res, content = 'done', usage = { prompt_tokens: 100, completion_tokens: 20 }) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage }));
};
const primary = baseUrl => ({ baseUrl, modelId: 'primary-test-model', runtime: { retries: 0 }, pricing: { input: 1, output: 2 } });
test('fallback switches endpoints before output and records the exact successful model', async t => {
  assert.equal(typeof api.createModelRuntime, 'function');
  const calls = [], events = [];
  const baseUrl = await endpoint(t, (req, res) => { calls.push('primary'); res.writeHead(503); res.end(); });
  const backup = await endpoint(t, (req, res) => { calls.push('backup'); response(res); });
  const runtime = api.createModelRuntime({ primary: primary(baseUrl), fallbacks: [{ ...primary(backup), modelId: 'backup-test-model' }], maxCost: 1, emit: event => events.push(event) });
  const result = await streamChat(runtime.provider, [{ role: 'user', content: 'test' }], { signal: AbortSignal.timeout(5000) });
  assert.equal(result.content, 'done'); assert.deepEqual(calls, ['primary', 'backup']);
  assert.ok(events.some(e => e.type === 'provider_fallback' && e.toModel === 'backup-test-model'));
  assert.equal(runtime.snapshot().calls.at(-1).model, 'backup-test-model');
  assert.ok(Math.abs(runtime.snapshot().costUsd - 0.00014) < 1e-9);
});
test('partial streams are charged conservatively and never replayed on another provider', async t => {
  assert.equal(typeof api.createModelRuntime, 'function');
  let backupCalls = 0;
  const baseUrl = await endpoint(t, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
    setTimeout(() => res.destroy(), 20);
  });
  const backup = await endpoint(t, (req, res) => { backupCalls++; response(res); });
  const runtime = api.createModelRuntime({ primary: primary(baseUrl), fallbacks: [primary(backup)], maxCost: 1 });
  let text = '';
  await assert.rejects(streamChat(runtime.provider, [{ role: 'user', content: 'test' }], { signal: AbortSignal.timeout(3000), onToken: delta => { text += delta; } }));
  assert.equal(text, 'partial'); assert.equal(backupCalls, 0);
  assert.ok(runtime.snapshot().costUsd > 0); assert.equal(runtime.snapshot().calls[0].estimated, true);
});
test('budget requires explicit pricing, reserves concurrent requests and stops subsequent requests', async t => {
  assert.equal(typeof api.createModelRuntime, 'function');
  assert.throws(() => api.createModelRuntime({ primary: { baseUrl: 'http://localhost', modelId: 'x' }, maxCost: 1 }), /pricing/i);
  let calls = 0;
  const baseUrl = await endpoint(t, (req, res) => { calls++; setTimeout(() => response(res, 'done', { prompt_tokens: 100, completion_tokens: 1 }), 30); });
  const runtime = api.createModelRuntime({ primary: { ...primary(baseUrl), pricing: { input: 1000, output: 1000 } }, maxCost: 0.2, maxOutputTokens: 100 });
  const options = { signal: AbortSignal.timeout(3000) }, messages = [{ role: 'user', content: 'x' }];
  const results = await Promise.allSettled([streamChat(runtime.provider, messages, options), streamChat(runtime.provider, messages, options)]);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.equal(calls, 1);
  await assert.rejects(streamChat(runtime.provider, [{ role: 'user', content: 'large'.repeat(100) }], options), /budget/i);
  assert.equal(calls, 1);
});
test('explicit zero pricing is valid; missing pricing is reported as unknown, not free', async t => {
  assert.equal(typeof api.createModelRuntime, 'function');
  const baseUrl = await endpoint(t, (req, res) => response(res));
  for (const pricing of [undefined, { input: 0, output: 0 }]) {
    const runtime = api.createModelRuntime({ primary: { baseUrl, modelId: 'free-test-model', pricing }, ...(pricing ? { maxCost: 0.01 } : {}) });
    await streamChat(runtime.provider, [{ role: 'user', content: 'x' }], { signal: AbortSignal.timeout(3000) });
    assert.equal(runtime.snapshot().costUsd, pricing ? 0 : null);
  }
});
test('4xx capability failures can move to a compatible fallback before output', async t => {
  const baseUrl = await endpoint(t, (req, res) => { res.writeHead(400); res.end(); });
  const backup = await endpoint(t, (req, res) => response(res, 'compatible'));
  const runtime = api.createModelRuntime({ primary: primary(baseUrl), fallbacks: [{ ...primary(backup), modelId: 'compatible-backup', contextWindow: 4096 }] });
  assert.equal(runtime.provider.contextWindow, 4096, 'requests must fit the smallest configured fallback window');
  assert.equal((await streamChat(runtime.provider, [{ role: 'user', content: 'task' }], { signal: AbortSignal.timeout(3000) })).content, 'compatible');
});
test('an ambiguous connection failure consumes budget before an automatic retry can send again', async t => {
  let attempts = 0;
  const baseUrl = await endpoint(t, async (req, res) => {
    for await (const _chunk of req) { /* request reached the provider */ }
    if (++attempts === 1) req.socket.destroy(); else response(res);
  });
  const runtime = api.createModelRuntime({
    primary: { ...primary(baseUrl), runtime: { retries: 1, retryBaseMs: 100 }, pricing: { input: 1000, output: 1000 } },
    maxCost: .22, maxOutputTokens: 100,
  });
  await assert.rejects(streamChat(runtime.provider, [{ role: 'user', content: 'x' }], { signal: AbortSignal.timeout(5000) }), { code: 'COST_LIMIT' });
  assert.equal(attempts, 1);
  const cost = runtime.snapshot();
  assert.equal(cost.calls.length, 1); assert.equal(cost.calls[0].estimated, true); assert.equal(cost.calls[0].failed, true);
  assert.ok(cost.costUsd > 0 && cost.costUsd <= .22);
  assert.equal(cost.reservedUsd, 0);
});
test('successful retries include unreported prior attempts in task cost', async t => {
  let attempts = 0;
  const baseUrl = await endpoint(t, async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    if (++attempts === 1) req.socket.destroy(); else response(res);
  });
  const runtime = api.createModelRuntime({ primary: { ...primary(baseUrl), runtime: { retries: 1, retryBaseMs: 100 } }, maxCost: 1, maxOutputTokens: 100 });
  await streamChat(runtime.provider, [{ role: 'user', content: 'x' }], { signal: AbortSignal.timeout(5000) });
  assert.equal(attempts, 2);
  const cost = runtime.snapshot();
  assert.equal(cost.calls.length, 2); assert.equal(cost.calls[0].estimated, true);
  assert.equal(cost.calls[1].estimated, false);
  assert.ok(cost.costUsd > cost.calls[1].costUsd);
});
test('HTTP rejections cost zero while retry wait cancellation does not charge a never-sent request', async t => {
  let attempts = 0;
  const baseUrl = await endpoint(t, (req, res) => { attempts++; res.writeHead(503); res.end(); });
  const stop = new AbortController();
  const runtime = api.createModelRuntime({ primary: { ...primary(baseUrl), runtime: { retries: 1, retryBaseMs: 100 } }, maxCost: 1 });
  await assert.rejects(streamChat({ ...runtime.provider, onRetry: () => stop.abort(new Error('cancel retry wait')) }, [{ role: 'user', content: 'x' }], { signal: stop.signal }), /cancel retry wait/);
  assert.equal(attempts, 1);
  const cost = runtime.snapshot();
  assert.equal(cost.calls.length, 1); assert.equal(cost.calls[0].estimated, false);
  assert.equal(cost.costUsd, 0); assert.equal(cost.reservedUsd, 0);
});
