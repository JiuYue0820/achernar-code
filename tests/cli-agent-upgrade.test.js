const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { spawn } = require('node:child_process');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-upgrade-'));
async function server(t, handler) { const s = http.createServer(async (req, res) => { let text = ''; for await (const chunk of req) text += chunk; try { const data = await handler(text ? JSON.parse(text) : null, req); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); } }); await new Promise(r => s.listen(0, '127.0.0.1', r)); t.after(() => s.close()); return `http://127.0.0.1:${s.address().port}/v1`; }
const toolCall = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const cli = (args, env = {}, directory = os.tmpdir()) => new Promise(resolve => { const p = spawn(process.execPath, [path.resolve(__dirname, '../cli/index.js'), '--trust-project', ...args], { cwd: directory, env: { ...process.env, ...env }, windowsHide: true }); let stdout = '', stderr = ''; p.stdout.on('data', b => stdout += b); p.stderr.on('data', b => stderr += b); p.on('close', code => resolve({ code, stdout, stderr })); });
test('workspace routes admitted paths, requires consent for new roots, and rejects link escapes', async () => {
  const { createWorkspace } = require('../cli/workspace');
  const root = temp(), other = temp(), forbidden = temp(); fs.writeFileSync(path.join(other, 'original.txt'), 'data');
  let approvals = 0;
  const workspace = createWorkspace(root, [other], async () => { approvals++; return false; });
  const resolved = await workspace.resolveFile({ action: 'read', path: path.join(other, 'original.txt') }); assert.equal(resolved.project, fs.realpathSync(other)); assert.equal(resolved.args.path, 'original.txt');
  assert.equal((await workspace.resolveTerminal({ command: 'pwd', reason: 'test', cwd: other })).project, fs.realpathSync(other));
  await assert.rejects(workspace.resolveFile({ action: 'write', path: path.join(forbidden, 'bad.txt') }), /not admitted/);
  assert.equal((await workspace.add(forbidden)).denied, true); assert.equal(approvals, 1);
  await workspace.add(forbidden, false); assert.equal((await workspace.resolveFile({ action: 'write', root: forbidden, path: 'new.txt' })).project, fs.realpathSync(forbidden));
  const outside = temp(); fs.symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(workspace.resolveFile({ action: 'write', path: 'linked/no.txt' }), /链接/);
  const readonly = require('../src/services/agent-workflow').readOnly({ definitions: [workspace.definition], execute: (_name, args) => workspace.execute(args) });
  assert.deepEqual((await readonly.execute('workspace', { action: 'list' })).directories, workspace.list().directories);
  assert.throws(() => readonly.execute('workspace', { action: 'add', path: outside }), /只读/);
});
test('CLI inherits launch cwd, performs cross-directory edits and commands, and restores roots on resume', async t => {
  const root = temp(), extra = temp(), home = temp(); let checked = false;
  const url = await server(t, body => {
    const system = body.messages[0].content; assert.ok(system.includes(root)); assert.ok(system.includes(JSON.stringify(extra)));
    if (body.messages.some(m => m.role === 'user' && m.content === 'resume roots')) { checked = true; return { choices: [{ message: { content: 'Roots restored.' } }] }; }
    const outputs = body.messages.filter(m => m.role === 'tool');
    if (!outputs.length) return { choices: [{ message: { tool_calls: [toolCall('primary', 'files', { action: 'write', path: 'primary.txt', content: 'root' }), toolCall('secondary', 'files', { action: 'write', root: extra, path: 'shared.txt', content: 'extra' })] } }] };
    if (outputs.length === 2) return { choices: [{ message: { tool_calls: [toolCall('cwd', 'terminal', { cwd: extra, command: 'node -p "process.cwd()"', reason: 'Check command directory' })] } }] };
    assert.match(outputs.at(-1).content, /exitCode\":0/); assert.ok(JSON.parse(outputs.at(-1).content).stdout.trim() === fs.realpathSync(extra));
    return { choices: [{ message: { content: 'Edited both directories and verified cwd.' } }] };
  });
  const env = { ACHERNAR_CLI_HOME: home, ACHERNAR_MODEL: 'fixture', ACHERNAR_BASE_URL: url, ACHERNAR_API_KEY: 'test-only' };
  // --trust-project covers only the startup folder; trust the added root explicitly first.
  assert.equal((await cli(['--json', 'sessions'], env, extra)).code, 0);
  const result = await cli(['--json', '--add-dir', extra, 'run', '--approval', 'auto', 'work across roots'], env, root);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(path.join(root, 'primary.txt'), 'utf8'), 'root'); assert.equal(fs.readFileSync(path.join(extra, 'shared.txt'), 'utf8'), 'extra');
  const id = JSON.parse(result.stdout).data.sessionId, saved = JSON.parse(fs.readFileSync(require('../cli/session-records').sessionFile(home, id, root)));
  assert.equal(saved.project, fs.realpathSync(root)); assert.ok(saved.directories.includes(fs.realpathSync(extra)));
  const resumed = await cli(['--json', 'resume', id, 'resume roots'], env, root); assert.equal(resumed.code, 0, resumed.stdout); assert.equal(checked, true);
});
test('CLI banner animation stops with cursor restored and plain mode emits no control codes', async () => {
  const { frame, showBanner } = require('../cli/banner');
  let text = ''; const stream = { isTTY: true, columns: 90, rows: 24, write: value => text += value };
  await showBanner({ stream, animate: false, env: { NO_COLOR: '' } }); assert.match(text, /Achernar/); assert.doesNotMatch(text, /\x1b/);
  text = ''; const controller = new AbortController(); const pending = showBanner({ stream, env: {}, signal: controller.signal }); controller.abort();
  await assert.rejects(pending, /abort/i); assert.ok(text.endsWith('\x1b[0m\x1b[?25h\n'));
  assert.notDeepEqual(frame(0), frame(4)); assert.ok(frame(13, { width: 32, final: true, color: false }).every(line => line.length < 32));
});
test('CLI config command accepts documented global flags and returns JSON on parser errors', async () => {
  const home = temp(), env = { ACHERNAR_CLI_HOME: home, ACHERNAR_MODEL: '', ACHERNAR_BASE_URL: '', ACHERNAR_API_FORMAT: '' };
  const configured = await cli(['--json', 'config', 'set', '--model', 'fixture', '--base-url', 'http://127.0.0.1:12345/v1', '--format', 'openai-responses'], env);
  assert.equal(configured.code, 0, configured.stdout + configured.stderr); assert.equal(JSON.parse(configured.stdout).ok, true);
  const settings = JSON.parse(fs.readFileSync(path.join(home, 'config.json'))); assert.equal(settings.modelId, 'fixture'); assert.equal(settings.apiFormat, 'openai-responses');
  for (const format of ['--json', '--stream-json']) {
    const error = await cli([format, 'run'], env);
    assert.equal(error.code, 1); assert.equal(error.stderr, '');
    const parsed = JSON.parse(error.stdout); assert.equal(parsed.ok, false);
    if (format === '--stream-json') assert.equal(parsed.type, 'error');
  }
});
test('CLI writes and verifies a real file, resumes, denies unattended writes, supports JSON errors', async t => {
  const root = temp(), home = temp(); fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Fixture project instructions');
  const url = await server(t, body => {
    assert.match(body.messages[0].content, /Fixture project instructions/);
    const outputs = body.messages.filter(m => m.role === 'tool');
    if (!outputs.length && body.messages.some(m => m.role === 'user' && m.content === 'continue')) return { choices: [{ message: { content: 'Resumed with previous execution context.' } }] };
    if (!outputs.length) return { choices: [{ message: { tool_calls: [toolCall('write', 'files', { action: 'write', path: 'result.txt', content: 'verified-content' })] } }] };
    if (outputs.some(m => m.content.includes('denied'))) return { choices: [{ message: { content: 'Write was denied.' } }] };
    if (outputs.length === 1) return { choices: [{ message: { tool_calls: [toolCall('verify', 'terminal', { command: 'node -e "process.stdout.write(require(\'fs\').readFileSync(\'result.txt\',\'utf8\'))"', reason: 'Verify saved bytes' })] } }] };
    return { choices: [{ message: { content: 'Verified actual file and command.' } }] };
  });
  const env = { ACHERNAR_CLI_HOME: home, ACHERNAR_BASE_URL: url, ACHERNAR_MODEL: 'fixture', ACHERNAR_API_KEY: 'test-secret' };
  const run = await cli(['--json', '-C', root, 'run', '--approval', 'auto', 'write file'], env); assert.equal(run.code, 0, run.stderr + run.stdout);
  const data = JSON.parse(run.stdout).data; assert.equal(fs.readFileSync(path.join(root, 'result.txt'), 'utf8'), 'verified-content'); assert.ok(data.events.some(e => e.type === 'tool_result' && e.name === 'terminal' && !e.failed)); assert.doesNotMatch(run.stdout, /test-secret/);
  const resumed = await cli(['--json', '-C', root, 'resume', data.sessionId, 'continue'], env); assert.equal(resumed.code, 0, resumed.stdout); assert.match(JSON.parse(resumed.stdout).data.content, /Resumed/);
  fs.unlinkSync(path.join(root, 'result.txt'));
  const denied = await cli(['--json', '-C', root, 'run', 'write file'], env); assert.equal(denied.code, 0); assert.equal(fs.existsSync(path.join(root, 'result.txt')), false); assert.match(denied.stdout, /denied/);
  const bad = await cli(['--json', 'resume', '../bad'], env); assert.equal(bad.code, 1); assert.equal(JSON.parse(bad.stdout).ok, false);
});
test('CLI agent changes execution phase with enforced read-only tools, then returns to code', async t => {
  const root = temp(), home = temp(); let blocked = false, round = 0;
  const url = await server(t, body => {
    const toolResults = body.messages.filter(m => m.role === 'tool');
    const steps = [
      toolCall('phase-plan', 'execution_mode', { mode: 'plan', reason: 'Inspect the task first' }),
      toolCall('blocked-write', 'files', { action: 'write', path: 'denied.js', content: 'must not exist' }),
      toolCall('phase-code', 'execution_mode', { mode: 'code', reason: 'Implement after inspection' }),
      toolCall('allowed-write', 'files', { action: 'write', path: 'allowed.js', content: 'verified' }),
    ];
    if (round === 2) { blocked = /Execution mode is plan/.test(toolResults.at(-1).content); assert.equal(fs.existsSync(path.join(root, 'denied.js')), false); }
    const call = steps[round++];
    return { choices: [{ message: call ? { tool_calls: [call] } : { content: 'Verified phase permissions.' } }] };
  });
  const result = await cli(['--json', '-C', root, 'run', '--approval', 'auto', 'Verify live phase changes'], { ACHERNAR_CLI_HOME: home, ACHERNAR_BASE_URL: url, ACHERNAR_MODEL: 'fixture' });
  assert.equal(result.code, 0, result.stdout); assert.equal(blocked, true); assert.equal(fs.readFileSync(path.join(root, 'allowed.js'), 'utf8'), 'verified');
});
