const test = require('node:test'), assert = require('node:assert/strict');
const { LiveControls, requiresApproval } = require('../cli/live-controls');
const { TerminalUI } = require('../cli/tui');
const { EventEmitter } = require('node:events');
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const input = new EventEmitter(), output = new EventEmitter(); Object.assign(input, { setRawMode() {}, pause() {} }); Object.assign(output, { write() {}, columns: 110, rows: 36 });
  const events = [], live = new LiveControls({ onChange: event => events.push(event) });
  const ui = new TerminalUI({ input, output, project: process.cwd(), mode: 'code', version: '0.2.0', onControl: command => {
    if (command === 'cycle-approval') live.setApproval(['strict', 'code', 'auto'][(['strict', 'code', 'auto'].indexOf(live.approval) + 1) % 3]);
    else if (command === 'cycle-mode') live.setMode(['code', 'plan', 'review'][(['code', 'plan', 'review'].indexOf(live.mode) + 1) % 3]);
    else if (command.startsWith('/approval ')) live.setApproval(command.slice(10));
    else if (command.startsWith('/mode ')) live.setMode(command.slice(6));
  } }); ui.state.busy = true;
  const authorize = (name, args) => live.authorize(name, args, { ui, signal: AbortSignal.timeout(5000), project: process.cwd() });
  return { ui, live, authorize, events };
}
test('three approval levels distinguish source edits, deletion, shell, web and MCP', () => {
  assert.equal(requiresApproval('strict', 'files', { action: 'read', path: 'app.js' }), true);
  assert.equal(requiresApproval('code', 'files', { action: 'write', path: 'app.js' }), false);
  assert.equal(requiresApproval('code', 'files', { action: 'edit', path: 'app.ts' }), false);
  assert.equal(requiresApproval('code', 'files', { action: 'delete', path: 'app.js' }), true);
  assert.equal(requiresApproval('code', 'files', { action: 'write', path: 'document.pdf' }), true);
  for (const name of ['terminal', 'web', 'mcp', 'skills']) assert.equal(requiresApproval('code', name, { action: 'call' }), true);
  assert.equal(requiresApproval('auto', 'terminal', {}), false);
});
test('changing approval during a pending operation resolves it and applies to the next call', async () => {
  const f = fixture(), pending = f.authorize('files', { action: 'write', path: 'app.js' }); await settle();
  assert.ok(f.ui.state.approvalRequest); f.ui.parser.feed('\x1bOQ'); // F2 -> Code
  assert.equal(await pending, true); assert.equal(f.live.approval, 'code');
  assert.equal(await f.authorize('files', { action: 'edit', path: 'app.js' }), true);
  const shell = f.authorize('terminal', { command: 'npm test' }); await settle(); assert.ok(f.ui.state.picker);
  f.ui.editor.set('/approval auto'); f.ui.key('enter'); assert.equal(await shell, true); assert.equal(f.live.approval, 'auto');
  assert.equal(await f.authorize('terminal', { command: 'npm test' }), true); f.ui.close();
});
test('first approval supports mouse selection of a persistent mode', async () => {
  const f = fixture(), pending = f.authorize('terminal', { command: 'npm test' }); await settle();
  const index = f.ui.state.matches.findIndex(e => e.value === 'auto'); const hit = f.ui.frame.hitboxes.find(b => b.action === 'select' && b.index === index);
  assert.ok(hit); f.ui.mouse({ button: 0, down: true, x: hit.x, y: hit.y }); assert.equal(await pending, true); assert.equal(f.live.approval, 'auto'); f.ui.close();
});
test('agent phase changes cannot override user read-only mode; user hotkey changes are immediate', () => {
  const f = fixture(); f.live.setMode('plan', 'agent', 'Inspect project'); assert.throws(() => f.live.assertAllowed('terminal', {}), /plan/);
  f.live.setMode('code', 'agent', 'Implement verified plan'); assert.doesNotThrow(() => f.live.assertAllowed('terminal', {}));
  f.ui.parser.feed('\x1b[Z'); assert.equal(f.live.mode, 'plan'); assert.throws(() => f.live.setMode('code', 'agent'), /Only the user/);
  f.ui.editor.set('/mode code'); f.ui.key('enter'); assert.equal(f.live.mode, 'code');
  assert.ok(f.events.some(e => e.source === 'agent')); f.ui.close();
});
test('canceling pending approval aborts without running operation', async () => {
  const f = fixture(), abort = new AbortController();
  const pending = f.live.authorize('files', { action: 'write', path: 'app.js' }, { ui: f.ui, signal: abort.signal, project: process.cwd() }); await settle();
  abort.abort(new Error('Stopped')); await assert.rejects(pending, /Stopped/); assert.equal(f.ui.state.picker, null); f.ui.close();
});
test('diff approval is visible, scrollable and keeps permission choices inside narrow terminals', async () => {
  const f = fixture();
  const preview = { path: 'index.ts', diff: '--- a/index.ts\n+++ b/index.ts\n@@ -1,40 +1,40 @@\n-old\n+new\n' + Array.from({ length: 40 }, (_, i) => ` line ${i}`).join('\n') };
  const pending = f.live.authorize('files', { action: 'edit', path: 'index.ts', oldText: 'old', content: 'new' }, {
    ui: f.ui, signal: AbortSignal.timeout(5000), project: process.cwd(), preview,
  });
  await settle();
  assert.equal(f.ui.state.approvalRequest.preview, preview);
  for (const [columns, rows] of [[110, 40], [62, 24], [42, 18]]) {
    f.ui.output.columns = columns; f.ui.output.rows = rows; f.ui.draw();
    const before = f.ui.frame.canvas.lines(false).join('\n');
    assert.match(before, /a\/index.ts/);
    assert.ok(f.ui.frame.hitboxes.filter(b => b.action === 'select').every(b => b.y > 0 && b.y < rows - 1));
    f.ui.key('pagedown');
    assert.ok(f.ui.state.approvalPreviewScroll > 0);
    assert.notEqual(f.ui.frame.canvas.lines(false).join('\n'), before);
    f.ui.state.approvalPreviewScroll = 0;
  }
  f.ui.key('escape'); assert.equal(await pending, false); f.ui.close();
});
test('transient provider retries are visible while a task waits', () => {
  const f = fixture();
  f.ui.event({ type: 'provider_retry', attempt: 2, limit: 3, waitMs: 2000, status: 503 });
  f.ui.draw();
  assert.match(f.ui.frame.canvas.lines(false).join('\n'), /Retry 2\/3/);
  f.ui.close();
});
