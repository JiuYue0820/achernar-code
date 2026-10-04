const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const api = (() => { try { return require('../cli/eval/tasks'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; return {}; } })();
test('fixed eval rejects broken output and passes correct artifacts with independent acceptance checks', async t => {
  assert.ok(Array.isArray(api.tasks), 'fixed task suite must exist');
  for (const task of api.tasks) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'achernar-eval-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await task.seed(root);
    assert.equal((await task.accept(root, [])).passed, false, task.id + ' broken baseline');
    const events = await task.fixture(root);
    assert.equal((await task.accept(root, events)).passed, true, task.id + ' fixed result');
  }
});
test('eval threshold fails regressions and distinguishes fixture data from live model quality', () => {
  const { evaluateReport } = require('../cli/eval/report');
  assert.equal(evaluateReport([{ passed: true }, { passed: false }], 1).ok, false);
  assert.equal(evaluateReport([{ passed: true }], 1).passRate, 1);
  assert.throws(() => evaluateReport([], 1), /No tasks/);
});
test('installed CLI eval entry creates missing parent directories and writes its labeled report', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'achernar-cli-eval-entry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = require('node:child_process').spawnSync(process.execPath, [path.resolve(__dirname, '../cli/index.js'), '--json', 'eval', '--fixture', '--task', 'typed-edit', '--out', path.join(root, 'missing/parent/run')], { windowsHide: true, encoding: 'utf8', timeout: 20000, env: { ...process.env, ACHERNAR_CLI_HOME: path.join(root, 'home'), ACHERNAR_NOTIFICATIONS: '0' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(await fs.readFile(path.join(root, 'missing/parent/run/report.json'), 'utf8'));
  assert.equal(report.kind, 'deterministic-fixture'); assert.equal(report.passed, 1);
  assert.equal(JSON.parse(result.stdout).data.kind, 'deterministic-fixture');
});
test('eval rejects an invalid threshold before creating artifacts or requesting a model', async t => {
  const { main } = require('../cli/eval');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'achernar-eval-preflight-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const out = path.join(root, 'run'), logs = [];
  await assert.rejects(main(['node', 'eval', '--fixture', '--task', 'filtered-search', '--out', out, '--threshold', '2'], { setup: {}, log: value => logs.push(value) }), /threshold/i);
  assert.deepEqual(logs, [], 'invalid settings must not consume a task first');
  await assert.rejects(fs.access(out), { code: 'ENOENT' });
});
test('standalone eval binds stored credentials to their endpoint and pricing to their model', () => {
  const { resolveEvalProfile } = require('../cli/eval');
  assert.equal(typeof resolveEvalProfile, 'function');
  const saved = { modelId: 'old-model', baseUrl: 'https://original.invalid/v1', apiFormat: 'openai-chat-completions', credentialId: 'saved-id', contextWindow: 128000, pricing: { input: 1, output: 2 } };
  let reads = 0;
  const credential = id => { assert.equal(id, 'saved-id'); reads++; return 'saved-secret'; };
  const switchedEndpoint = resolveEvalProfile(saved, { ACHERNAR_BASE_URL: 'https://other.invalid/v1' }, credential);
  assert.equal(switchedEndpoint.apiKey, ''); assert.equal(switchedEndpoint.pricing, null); assert.equal(reads, 0);
  const switchedFormat = resolveEvalProfile(saved, { ACHERNAR_API_FORMAT: 'anthropic-messages' }, credential);
  assert.equal(switchedFormat.apiKey, ''); assert.equal(switchedFormat.pricing, null); assert.equal(reads, 0);
  const switchedModel = resolveEvalProfile(saved, { ACHERNAR_MODEL: 'new-model' }, credential);
  assert.equal(switchedModel.apiKey, 'saved-secret'); assert.equal(switchedModel.pricing, null); assert.equal(switchedModel.contextWindow, 32768);
  const same = resolveEvalProfile(saved, { ACHERNAR_BASE_URL: saved.baseUrl + '/' }, credential);
  assert.deepEqual(same.pricing, saved.pricing); assert.equal(same.apiKey, 'saved-secret'); assert.equal(same.contextWindow, 128000);
  const explicit = resolveEvalProfile(saved, { ACHERNAR_BASE_URL: 'https://other.invalid/v1', ACHERNAR_API_KEY: 'explicit-secret' }, credential);
  assert.equal(explicit.apiKey, 'explicit-secret');
});
test('failed eval retains completed request usage without summing cumulative usage packets twice', () => {
  const { executionMetrics } = require('../cli/eval/report');
  assert.equal(typeof executionMetrics, 'function');
  const cost = { costUsd: .0003, knownCostUsd: .0003, maxCostUsd: null, reservedUsd: 0, unpricedCalls: 0 };
  const rows = [
    { type: 'event', event: { type: 'usage', usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 } } },
    { type: 'event', event: { type: 'usage', usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } } },
    { type: 'event', event: { type: 'cost', ...cost } },
    { type: 'event', event: { type: 'response_end' } },
    { type: 'error', error: { status: 429, message: 'Provider rate limit reached.' } },
  ];
  const metrics = executionMetrics(rows);
  assert.deepEqual(metrics.usage, { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 });
  assert.equal(metrics.usageComplete, false);
  assert.deepEqual(metrics.cost, cost);
  assert.equal(executionMetrics([]).usage, null, 'missing usage is not zero usage');
  const success = executionMetrics([...rows.slice(0, -1), { type: 'result', data: { totalUsage: { prompt_tokens: 200, completion_tokens: 20, total_tokens: 220 }, cost } }]);
  assert.equal(success.usageComplete, true);
  assert.equal(success.usage.total_tokens, 220);
});
test('live eval validates budget pricing before making requests or creating a run directory', async t => {
  const { main } = require('../cli/eval');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'achernar-eval-budget-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const out = path.join(root, 'run');
  await assert.rejects(main(['node', 'eval', '--live', '--out', out, '--max-cost', '.01'], {
    setup: { modelId: 'unpriced', baseUrl: 'https://unused.invalid/v1', apiKey: '' }, log: () => assert.fail('must not start a task'),
  }), { code: 'MISSING_PRICING' });
  await assert.rejects(fs.access(out), { code: 'ENOENT' });
});
test('a real eval subprocess preserves metering when its local provider returns HTTP 429', { timeout: 15000 }, async t => {
  const http = require('node:http'), { spawn } = require('node:child_process');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'achernar-eval-rate-limit-')), home = path.join(root, 'home');
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(home);
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain fixture request */ }
    if (++calls > 1) { res.writeHead(429, { 'retry-after': '600' }); res.end(); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'read', type: 'function', function: { name: 'files', arguments: '{"action":"list","path":"."}' } }] } }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  await fs.writeFile(path.join(home, 'config.json'), JSON.stringify({ modelId: 'rate-limit-fixture', baseUrl, apiFormat: 'openai-chat-completions', pricing: { input: 1, output: 2 } }));
  const out = path.join(root, 'run');
  const execution = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../cli/eval/index.js'), '--live', '--task', 'filtered-search', '--out', out], {
      windowsHide: true, timeout: 10000, env: { ...process.env, ACHERNAR_CLI_HOME: home, ACHERNAR_BASE_URL: baseUrl, ACHERNAR_MODEL: 'rate-limit-fixture', ACHERNAR_API_FORMAT: 'openai-chat-completions', ACHERNAR_API_KEY: 'fixture-key', ACHERNAR_NOTIFICATIONS: '0' },
    });
    let stderr = ''; child.stdout.resume(); child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject); child.on('close', code => resolve({ code, stderr })); child.stdin.end();
  });
  assert.equal(execution.code, 1, execution.stderr); assert.equal(calls, 2);
  const report = JSON.parse(await fs.readFile(path.join(out, 'report.json'), 'utf8')), result = report.results[0];
  assert.equal(report.ok, false); assert.equal(result.error.status, 429);
  assert.deepEqual(result.usage, { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 });
  assert.equal(result.usageComplete, false);
  assert.ok(Math.abs(result.cost.costUsd - .00012) < 1e-10);
  assert.equal(result.cost.reservedUsd, 0);
});
