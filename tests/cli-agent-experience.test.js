const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), { EventEmitter } = require('node:events');
const { createTaskInbox } = require('../cli/task-inbox');
const { createTaskReport } = require('../cli/task-report');
const { TerminalUI } = require('../cli/tui');
const { runAgent } = require('../src/services/agent');
function uiFixture(options = {}) {
  const input = new EventEmitter(), output = new EventEmitter(); Object.assign(input, { setRawMode() {}, pause() {} }); Object.assign(output, { columns: 110, rows: 40, write() {} });
  return new TerminalUI({ input, output, project: process.cwd(), model: 'fixture', ...options });
}
test('task inbox bounds input, preserves order, and returns unapplied messages on close', () => {
  const inbox = createTaskInbox({ limit: 2 }); assert.equal(inbox.push(' first '), 1); inbox.push('second'); assert.throws(() => inbox.push('third'), /full/);
  assert.deepEqual(inbox.take(), ['first', 'second']); inbox.push('pending'); assert.deepEqual(inbox.close(), ['pending']); assert.throws(() => inbox.push('late'), /finishing/);
});
test('running editor queues steering without starting another task; display controls persist and do not leak into prompt', () => {
  const inbox = createTaskInbox(), preferences = [], ui = uiFixture({ onSteer: text => inbox.push(text), onPreference: value => preferences.push(value), onSubmit: () => assert.fail('second task') });
  ui.state.busy = true; ui.editor.set('Also cover empty input.'); ui.key('enter'); assert.deepEqual(inbox.take(), ['Also cover empty input.']); assert.equal(ui.editor.text, ''); assert.equal(ui.state.queued, 1);
  ui.event({ type: 'steering_applied', text: 'Also cover empty input.' }); assert.equal(ui.state.queued, 0); assert.equal(ui.state.logs.at(-1).kind, 'user');
  ui.editor.set('/thinking'); ui.key('enter'); assert.equal(ui.state.preferences.thinking, true);
  ui.event({ type: 'reasoning', delta: 'Reasoning text' }); assert.equal(ui.state.logs.at(-1).expanded, true);
  ui.parser.feed('\x14'); assert.equal(ui.state.logs.at(-1).expanded, false); assert.equal(preferences.at(-1).thinking, false);
  ui.parser.feed('\x0f'); assert.equal(preferences.at(-1).details, true); ui.close();
});
test('report lists actual mutations and command outcomes without calling a successful command a passed test', () => {
  const report = createTaskReport(); report.event({ type: 'file_change', path: 'a.js', action: 'write' }); report.event({ type: 'file_change', path: 'a.js', action: 'edit' });
  report.event({ type: 'tool_result', name: 'terminal', arguments: { command: 'node --version' }, result: '{"exitCode":0}', failed: false });
  report.event({ type: 'tool_result', name: 'terminal', arguments: { command: 'npm test' }, result: '{"exitCode":1}', failed: true });
  assert.equal(report.snapshot().files.length, 1); assert.deepEqual(report.snapshot().commands.map(c => c.exitCode), [0, 1]);
});
test('agent questions support single choice, multiple selection, custom input and cancel', async () => {
  const { answerAgentQuestion } = require('../cli/agent-question');
  const choices = [], ui = { choose: async () => choices.shift(), ask: async () => 'Custom answer', toast() {} }, payload = { question: 'Pick', options: ['One', 'Two'] }, signal = AbortSignal.timeout(5000);
  choices.push('option:1'); assert.deepEqual((await answerAgentQuestion(payload, { ui, signal })).selected, ['Two']);
  choices.push('option:0', 'option:1', 'option:0', 'done'); assert.deepEqual((await answerAgentQuestion({ ...payload, multiple: true }, { ui, signal })).selected, ['Two']);
  choices.push('custom'); assert.equal((await answerAgentQuestion(payload, { ui, signal })).text, 'Custom answer');
  choices.push(''); assert.equal((await answerAgentQuestion(payload, { ui, signal })).approved, false);
});
test('agent applies queued user corrections at response boundary and reports final-only text and cumulative usage', async t => {
  const inbox = createTaskInbox(), events = []; let rounds = 0;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const b of req) raw += b; const body = JSON.parse(raw);
    assert.match(body.messages[0].content, /terminal coding agent/); assert.doesNotMatch(body.messages[0].content, /TTS-Part/);
    if (++rounds === 1) inbox.push('Use the revised requirement.'); else assert.equal(body.messages.at(-2).content, 'Use the revised requirement.');
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: rounds === 1 ? 'Initial update.' : 'Revised result.' } }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const result = await runAgent({ provider: { modelId: 'fixture', baseUrl: `http://127.0.0.1:${server.address().port}/v1` }, messages: [{ role: 'user', content: 'Original task.' }], host: 'cli', takeMessages: () => inbox.take(), emit: e => events.push(e), signal: AbortSignal.timeout(5000) });
  assert.equal(rounds, 2); assert.equal(result.finalContent, 'Revised result.'); assert.match(result.content, /Initial update/); assert.equal(result.totalUsage.total_tokens, 220);
  assert.deepEqual(events.filter(e => e.type === 'response_end').map(e => e.phase), ['update', 'final']);
});
test('round budget updates once per request, prompts truthful closure and keeps live read-only constraints', async t => {
  let round = 0, firstSystem; const events = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const b of req) raw += b; const body = JSON.parse(raw); round++;
    // CLI keeps the system prompt byte-identical across rounds so provider prompt caches hit.
    assert.doesNotMatch(body.messages[0].content, /Current run budget/);
    firstSystem ??= body.messages[0].content; assert.equal(body.messages[0].content, firstSystem);
    const system = body.messages.at(-1).content;
    assert.equal(body.messages.filter(m => /Current run budget:/.test(m.content)).length, 1);
    assert.match(system, new RegExp(`Current run budget: ${4 - round} model responses`));
    assert.match(system, /never claim an unfinished task is complete/);
    assert.match(system, /Current live execution mode: plan/);
    res.setHeader('Content-Type', 'application/json');
    const message = round < 3 ? { tool_calls: [{ id: 'read-' + round, type: 'function', function: { name: 'files', arguments: '{"action":"read","path":"existing.txt"}' } }] } : { content: 'Inspected existing.txt; no edits requested or performed.' };
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const tools = { definitions: [{ type: 'function', function: { name: 'files', parameters: { type: 'object' } } }], execute: async () => ({ content: 'unchanged' }) };
  const result = await runAgent({ provider: { modelId: 'fixture', baseUrl: `http://127.0.0.1:${server.address().port}/v1` }, messages: [{ role: 'user', content: 'Inspect only.' }], host: 'cli', maxRounds: 3, dynamicExecution: () => 'plan', tools, emit: e => events.push(e), signal: AbortSignal.timeout(5000) });
  assert.equal(round, 3); assert.match(result.finalContent, /no edits/); assert.equal(events.filter(e => e.type === 'budget_warning').length, 1);
});
