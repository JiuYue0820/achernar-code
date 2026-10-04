const test = require('node:test'), assert = require('node:assert/strict');
const { executionContext } = require('../src/services/execution-context');
const { modelMessages, runAgent } = require('../src/services/agent');
const http = require('node:http');
test('CLI history removes code copies and duplicate output while preserving evidence and original records', () => {
  const code = 'const uniqueHistoricalPayload = "example";\n'.repeat(2000);
  const activities = [
    { name: 'files', arguments: { action: 'write', path: 'index.html', content: code }, result: '{"written":"index.html","bytes":80000}', failed: false },
    { name: 'files', arguments: { action: 'edit', path: 'index.html', oldText: code, content: 'updated' }, result: '{"written":"index.html"}', failed: false },
    { name: 'files', arguments: { action: 'read', path: 'index.html', startLine: 1, endLine: 5 }, result: JSON.stringify({ content: code, startLine: 1, endLine: 5, truncated: true }) },
    { name: 'terminal', arguments: { command: 'node --test', cwd: 'D:/project' }, result: JSON.stringify({ exitCode: 1, output: code, stdout: code, stderr: 'AssertionError: expected 2 received 3', timedOut: false }), failed: true },
    { name: 'files', arguments: { action: 'delete', path: 'USER-NOTES.txt' }, result: '{"denied":true,"message":"User refused deletion; do not bypass."}', failed: true },
    { name: 'ask_user', arguments: { question: 'Pick', options: ['One', 'Two'] }, result: '{"selected":["Two"],"answer":"Two","canceled":false}' },
  ];
  const before = JSON.stringify(activities), records = executionContext(activities);
  assert.equal(JSON.stringify(activities), before);
  assert.equal(records[0].arguments.content.characters, code.length);
  assert.equal(records[0].result.written, 'index.html');
  assert.equal(records[2].result.startLine, 1);
  assert.equal(records[3].result.exitCode, 1); assert.equal(records[3].result.stderr, 'AssertionError: expected 2 received 3'); assert.equal(records[3].result.output, undefined);
  assert.equal(records[4].result.denied, true); assert.match(records[4].result.message, /refused/); assert.equal(records[4].arguments.path, 'USER-NOTES.txt');
  assert.deepEqual(records[5].result.selected, ['Two']);
  assert.ok(JSON.stringify(records).length < before.length / 15);
});
test('user content, final responses and desktop history remain unchanged; malformed results stay explicit', () => {
  const messages = [{ role: 'user', content: 'Keep ALL original requirements.\n'.repeat(500) }, { role: 'assistant', content: 'Task stopped.', error: true, activities: [{ name: 'files', arguments: { action: 'write', path: 'x', content: 'secret historical body' }, result: '{bad JSON', failed: true }] }];
  const cli = modelMessages(messages, {}, 'cli'), desktop = modelMessages(messages, {}, 'desktop');
  assert.equal(cli[0].content, messages[0].content); assert.match(cli[1].content, /^Task stopped/);
  assert.ok(!cli[1].content.includes('secret historical body')); assert.ok(desktop[1].content.includes('secret historical body'));
  assert.match(cli[1].content, /bad JSON/);
});
test('actual resumed CLI request uses compact evidence and retains denials before the provider runs', async t => {
  let observed = false;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const b of req) raw += b; const data = JSON.parse(raw);
    const history = data.messages.find(m => m.role === 'assistant').content;
    assert.doesNotMatch(history, /HUGE_ORIGINAL_CODE/); assert.match(history, /keep\.txt/); assert.match(history, /denied/); assert.match(history, /sha256/);
    observed = true; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'Earlier write recorded; refused deletion stays refused.' } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const messages = [{ role: 'user', content: 'Original task.' }, { role: 'assistant', content: 'Interrupted.', activities: [
    { name: 'files', arguments: { action: 'write', path: 'a.js', content: 'HUGE_ORIGINAL_CODE'.repeat(3000) }, result: '{"written":"a.js"}' },
    { name: 'files', arguments: { action: 'delete', path: 'keep.txt' }, result: '{"denied":true}', failed: true },
  ] }, { role: 'user', content: 'Summarize the prior result only.' }];
  await runAgent({ provider: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, modelId: 'fixture' }, messages, host: 'cli', signal: AbortSignal.timeout(5000), emit() {} });
  assert.equal(observed, true);
});
