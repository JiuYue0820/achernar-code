const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { request, streamChat } = require('../src/services/providers');
const { compactTranscript } = require('../src/services/agent-core');
const { normalize } = require('../src/runtime-settings');
const runtime = { retries: 2, retryBaseMs: 50, retryMaxMs: 1000, requestTimeoutMs: 1000 };
async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}/v1`;
}
test('retry policy handles transient HTTP failures and leaves auth errors alone', async t => {
  let requests = 0, retries = 0, fail = 503;
  const baseUrl = await serve(t, (_req, res) => { requests++; res.writeHead(requests < 3 ? fail : 200); res.end('{}'); });
  assert.equal((await request({ baseUrl, runtime, onRetry: () => retries++ }, 'models')).status, 200);
  assert.equal(requests, 3); assert.equal(retries, 2);
  requests = 0; fail = 401;
  await assert.rejects(request({ baseUrl, runtime }, 'models'), error => error.status === 401);
  assert.equal(requests, 1);
});
test('Retry-After is respected and long waits are surfaced without retrying early', async t => {
  let attempts = 0, header = '0.1', waits = [];
  const baseUrl = await serve(t, (_req, res) => {
    attempts++; res.writeHead(attempts === 1 ? 429 : 200, { 'Retry-After': header }); res.end('{}');
  });
  const start = Date.now();
  await request({ baseUrl, runtime, onRetry: e => waits.push(e.waitMs) }, 'models');
  assert.ok(Date.now() - start >= 90); assert.ok(waits[0] >= 100);
  attempts = 0; header = '120';
  await assert.rejects(request({ baseUrl, runtime }, 'models'), e => e.status === 429 && e.retryAfterMs === 120000);
  assert.equal(attempts, 1);
});
test('canceling during backoff prevents subsequent requests', async t => {
  let attempts = 0; const controller = new AbortController();
  const baseUrl = await serve(t, (_req, res) => { attempts++; res.writeHead(503); res.end('{}'); });
  await assert.rejects(request({ baseUrl, runtime, onRetry: () => controller.abort(new Error('user stopped')) }, 'models', { signal: controller.signal }), /abort|user stopped/i);
  assert.equal(attempts, 1);
});
test('a broken response stream is not replayed after output has started', async t => {
  let attempts = 0, emitted = '';
  const baseUrl = await serve(t, (_req, res) => {
    attempts++; res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
    setTimeout(() => res.destroy(), 30);
  });
  await assert.rejects(streamChat({ baseUrl, modelId: 'fixture', runtime }, [], { signal: AbortSignal.timeout(3000), onToken: text => emitted += text }));
  assert.equal(emitted, 'partial'); assert.equal(attempts, 1);
});
test('compaction survives summary HTTP failure and retains valid tool pairs and current instructions', async t => {
  const baseUrl = await serve(t, (_req, res) => { res.writeHead(503); res.end('{}'); });
  const transcript = [{ role: 'system', content: 'Keep these rules.' }, { role: 'user', content: 'Previous task' }, { role: 'assistant', content: 'Previous update '.repeat(1500) },
    { role: 'user', content: 'Current request: fix only the named file.' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'read', type: 'function', function: { name: 'files', arguments: '{"action":"read","path":"a.js"}' } }] },
    { role: 'tool', tool_call_id: 'read', content: 'a'.repeat(40000) }];
  const result = await compactTranscript(transcript, { baseUrl, modelId: 'fixture', contextWindow: 4096, runtime: { retries: 0 } }, null, [], AbortSignal.timeout(3000), () => {});
  assert.equal(result[0].content, 'Keep these rules.');
  assert.ok(result.some(m => m.content === 'Current request: fix only the named file.'));
  assert.equal(result.at(-2).tool_calls[0].id, result.at(-1).tool_call_id);
  assert.ok(JSON.stringify(result).length < 6500);
});
test('compaction keeps the full current request and exact denied operation without trusting a summary', async t => {
  const baseUrl = await serve(t, (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'A short summary that omitted the refusal.' } }] })); });
  const requestText = 'Fix this task. ' + 'important requirement '.repeat(90);
  const transcript = [{ role: 'system', content: 'Keep rules.' }, { role: 'user', content: requestText },
    { role: 'assistant', content: null, tool_calls: [{ id: 'denied', type: 'function', function: { name: 'files', arguments: '{"action":"delete","path":"protected.txt"}' } }] },
    { role: 'tool', tool_call_id: 'denied', content: '{"denied":true,"message":"user refused"}' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'read', type: 'function', function: { name: 'files', arguments: '{"action":"read","path":"large.txt"}' } }] },
    { role: 'tool', tool_call_id: 'read', content: 'x'.repeat(40000) }];
  const result = await compactTranscript(transcript, { baseUrl, modelId: 'fixture', contextWindow: 6000 }, null, [], AbortSignal.timeout(3000), () => {});
  assert.ok(result.some(m => m.role === 'user' && m.content === requestText), 'current request must be verbatim');
  assert.match(JSON.stringify(result), /protected\.txt/);
  assert.match(JSON.stringify(result), /denied/);
});
test('timeouts are validated and command overrides above the old 120-second ceiling work', async () => {
  const seen = [];
  const tools = require('../src/services/core-tools').createTools({ project: process.cwd(), signal: AbortSignal.timeout(5000), mode: 'all', emit() {},
    terminalRunner: async (_command, _cwd, _signal, timeout) => { seen.push(timeout); return { exitCode: 0 }; },
    runtime: { commandTimeoutMs: 900000 } });
  await tools.execute('terminal', { command: 'echo test', reason: 'check default' });
  await tools.execute('terminal', { command: 'echo test', reason: 'check override', timeoutMs: 3600000 });
  assert.deepEqual(seen, [900000, 3600000]);
  await assert.rejects(tools.execute('terminal', { command: 'echo test', reason: 'invalid override', timeoutMs: 3600001 }));
  assert.throws(() => normalize({ retries: -1 }));
  assert.throws(() => normalize({ autoDiagnostics: 'true' }));
});
test('CLI settings survive process restarts and invalid values do not replace saved config', async t => {
  const { spawnSync } = require('node:child_process'), home = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-runtime-settings-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const entry = path.resolve(__dirname, '../cli/index.js');
  const cli = (...args) => spawnSync(process.execPath, [entry, '--json', 'settings', ...args], {
    env: { ...process.env, ACHERNAR_CLI_HOME: home, ACHERNAR_NOTIFICATIONS: '0' }, windowsHide: true, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(cli('commandTimeoutMs', '1200000').status, 0);
  assert.equal(JSON.parse(cli().stdout).data.commandTimeoutMs, 1200000);
  assert.equal(cli('commandTimeoutMs', 'nan').status, 1);
  assert.equal(JSON.parse(cli().stdout).data.commandTimeoutMs, 1200000);
});
test('settings do not advertise protections that are not connected to execution', () => {
  const schema = require('../src/runtime-settings');
  for (const key of ['maxTaskUsd', 'checkpoints', 'hooksEnabled', 'memoryEnabled', 'memoryTokenBudget']) {
    assert.equal(Object.hasOwn(schema.fields, key), false, `${key} must not appear as an implemented setting`);
  }
  assert.throws(() => normalize({ maxTaskUsd: 1 }), /not.*available|not.*implemented/i);
});
test('compaction retires completed old tool exchanges when arguments alone fill the window', async () => {
  const { compactTranscript } = require('../src/services/agent-core');
  const transcript = [{ role: 'system', content: 'Keep user files.' }, { role: 'user', content: 'Implement and verify the requested file.' }];
  for (let i = 0; i < 8; i++) {
    transcript.push({ role: 'assistant', content: null, tool_calls: [{ id: 'call' + i, type: 'function', function: { name: 'files', arguments: JSON.stringify({ action: 'write', path: 'output.js', content: 'code'.repeat(1000) }) } }] });
    transcript.push({ role: 'tool', tool_call_id: 'call' + i, content: JSON.stringify({ written: 'output.js', validation: { status: 'checked' } }) });
  }
  const compacted = await compactTranscript(transcript, { contextWindow: 2048 }, null, [], AbortSignal.timeout(2000), () => {});
  assert.ok(JSON.stringify(compacted).length < 4000);
  assert.ok(compacted.some(m => m.content === 'Implement and verify the requested file.'));
  assert.match(JSON.stringify(compacted), /output\.js/);
  const calls = new Set(compacted.flatMap(m => m.tool_calls || []).map(c => c.id));
  for (const message of compacted.filter(m => m.role === 'tool')) assert.ok(calls.has(message.tool_call_id));
});
test('child agents inherit the configured provider retry policy', async t => {
  let attempts = 0;
  const baseUrl = await serve(t, (_req, res) => { attempts++; res.writeHead(503); res.end('{}'); });
  const empty = { definitions: [], execute() {} };
  const tools = require('../src/services/subagents').withSubagents({
    tools: empty, config: { roles: ['reviewer'], enabled: true }, host: 'cli', runtime: { retries: 0 },
    resolveProvider: async () => ({ baseUrl, modelId: 'child-fixture', kind: 'openai' }),
    createChildTools: () => empty, signal: AbortSignal.timeout(10000), emit() {},
  });
  const result = await tools.execute('delegate', { tasks: [{ role: 'reviewer', task: 'Review only.' }] });
  assert.equal(result.isError, true);
  assert.equal(attempts, 1);
});
test('request deadline measures inactivity: a steady stream outlives it, a stalled one is cut off', async t => {
  const quick = { ...runtime, retries: 0, requestTimeoutMs: 1000 };
  let stall = false;
  const baseUrl = await serve(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    let sent = 0;
    const tick = setInterval(() => {
      if (stall && sent === 1) return; // after one chunk, go silent
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: String(sent) } }] })}\n\n`);
      if (++sent === 8) { clearInterval(tick); res.end('data: [DONE]\n\n'); }
    }, 400);
    res.on('close', () => clearInterval(tick));
  });
  // 8 chunks at 400 ms is ~3.2 s in total, three times the 1000 ms deadline.
  const steady = await streamChat({ baseUrl, modelId: 'fixture', runtime: quick }, [], { signal: AbortSignal.timeout(10000) });
  assert.equal(steady.content, '01234567');
  stall = true; let emitted = '';
  await assert.rejects(streamChat({ baseUrl, modelId: 'fixture', runtime: quick }, [], { signal: AbortSignal.timeout(5000), onToken: text => emitted += text }), error => error.name === 'TimeoutError' || /progress|abort/i.test(error.message));
  assert.equal(emitted, '0');
});
