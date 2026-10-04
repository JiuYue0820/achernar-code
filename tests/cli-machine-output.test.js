const test = require('node:test'), assert = require('node:assert/strict');
const api = (() => { try { return require('../cli/machine-output'); } catch { return {}; } })();
test('machine statuses/errors are English while model text and paths remain untouched', () => {
  assert.equal(typeof api.machineEvent, 'function');
  assert.match(api.machineEvent({ type: 'status', message: '正在连接模型服务' }).message, /Connecting/);
  assert.match(api.englishError({ message: '模型服务返回 HTTP 401，请检查 API Key', code: 'PROVIDER_HTTP_ERROR' }), /HTTP 401/);
  assert.match(api.englishError({ message: '模型服务返回 HTTP 429', code: 'PROVIDER_HTTP_ERROR' }), /rate.limit/i);
  const token = { type: 'token', delta: '用户需要中文答复' };
  assert.deepEqual(api.machineEvent(token), token);
  const event = api.machineEvent({ type: 'tool_result', result: JSON.stringify({ error: '工具参数无效', path: '文档/报告.md', content: '中文内容' }) });
  assert.equal(JSON.parse(event.result).path, '文档/报告.md');
  assert.equal(JSON.parse(event.result).content, '中文内容');
  assert.doesNotMatch(JSON.parse(event.result).error, /[\u3400-\u9fff]/);
});
test('no-op suppression blocks meaningless commands without changing compound commands', () => {
  const { assertUsefulCommand } = require('../cli/agent-policy');
  assert.equal(typeof assertUsefulCommand, 'function');
  for (const command of ['exit 0', 'exit 0;', ' true ', ':', 'echo done', 'Write-Output "done"']) assert.throws(() => assertUsefulCommand(command), /meaningful|no-op/i);
  for (const command of ['npm test', 'node --version', 'if (Test-Path x) { exit 0 }', 'npm test; exit 0', 'echo done > result.txt']) assert.doesNotThrow(() => assertUsefulCommand(command));
});
test('connection failures keep the host and root cause visible', async () => {
  assert.match(api.englishError({ message: '模型连接暂时失败：api.example.test: ENOTFOUND', code: 'PROVIDER_CONNECTION_ERROR', detail: 'api.example.test: ENOTFOUND' }), /Provider connection failed \[api\.example\.test: ENOTFOUND\] \(PROVIDER_CONNECTION_ERROR\)/);
  const { request } = require('../src/services/providers');
  const server = require('node:net').createServer(), port = await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  await new Promise(resolve => server.close(resolve));
  const error = await request({ baseUrl: `http://127.0.0.1:${port}/v1`, runtime: { retries: 0 } }, 'models').catch(error => error);
  assert.equal(error.code, 'PROVIDER_CONNECTION_ERROR');
  assert.equal(error.detail, `127.0.0.1:${port}: ECONNREFUSED`);
});
