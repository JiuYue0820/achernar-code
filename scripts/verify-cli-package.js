'use strict';
// Run against an extracted package with npm ci already completed, outside this checkout.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

async function main() {
  if (!process.argv[2]) throw new Error('Usage: node scripts/verify-cli-package.js <installed-extracted-package> [report.json]');
  const packageRoot = fs.realpathSync(path.resolve(process.argv[2]));
  const sourceRoot = fs.realpathSync(path.resolve(__dirname, '..'));
  assert.ok(packageRoot !== sourceRoot && !packageRoot.startsWith(sourceRoot + path.sep), 'Extract outside the source checkout to prevent dependency fallback');
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const entry = path.join(packageRoot, 'cli/index.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-package-check-'));
  const home = path.join(root, 'home'), project = path.join(root, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'AGENTS.md'), 'Package acceptance project. Verify actual saved bytes.');
  const checks = [], requests = [];
  const inputTask = 'input-check:\n```js\nconst 中文 = 42;\n```\n';
  const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  let mcpId;
  const server = http.createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      requests.push({ model: body.model, toolResults: body.messages.filter(m => m.role === 'tool').length });
      assert.equal(body.model, 'package-fixture');
      assert.match(body.messages[0].content, /Package acceptance project/);
      // The trailing <run_state> note is per-round host state, not the user's task.
      const task = body.messages.filter(m => m.role === 'user' && !String(m.content).startsWith('<run_state>')).at(-1).content;
      const results = body.messages.filter(m => m.role === 'tool');
      let message;
      if (task === inputTask) {
        message = { content: 'Multiline code and Unicode input preserved.' };
      } else if (task === 'resume-check') {
        assert.ok(body.messages.some(m => m.role === 'assistant' && /Package verified/.test(m.content)));
        message = { content: 'Resumed with persisted project and prior result.' };
      } else if (task === 'limit-check') {
        message = { tool_calls: [call('read', 'files', { action: 'read', path: 'AGENTS.md' })] };
      } else if (task === 'deny-check' || task === 'plan-check') {
        if (!results.length) message = { tool_calls: [call('blocked', 'files', { action: 'write', path: task + '.txt', content: 'forbidden' })] };
        else {
          assert.match(results.at(-1).content, task === 'deny-check' ? /denied/ : /只读|read.only|Execution mode/);
          message = { content: 'Requested mutation was blocked; no file was created.' };
        }
      } else if (results.length === 0) {
        message = { tool_calls: [call('write', 'files', { action: 'write', path: 'result.txt', content: 'verified-from-standalone-package' }), call('template', 'files', { action: 'write', path: 'index.html', template: 'workbench' })] };
      } else if (results.length === 2) {
        assert.match(results[0].content, /written/);
        assert.match(results[1].content, /written/);
        message = { tool_calls: [call('verify', 'terminal', { command: 'node -e "const fs=require(\'fs\');if(fs.readFileSync(\'result.txt\',\'utf8\')!==\'verified-from-standalone-package\')process.exit(1);console.log(\'saved bytes verified\')"', reason: 'Verify actual saved bytes' })] };
      } else if (results.length === 3) {
        assert.equal(JSON.parse(results.at(-1).content).exitCode, 0);
        message = { tool_calls: [call('mcp', 'mcp', { action: 'call', serverId: mcpId, tool: 'json_inspect', arguments: { json: '{"answer":42}', pointer: '/answer' } })] };
      } else {
        assert.match(results.at(-1).content, /42/);
        message = { content: 'Package verified: saved bytes, template and bundled MCP tool.' };
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 80, completion_tokens: 12, total_tokens: 92 } }));
    } catch (error) {
      res.statusCode = 500; res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, NODE_PATH: '', ACHERNAR_CLI_HOME: home, ACHERNAR_NOTIFICATIONS: '0', ACHERNAR_MODEL: 'package-fixture', ACHERNAR_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, ACHERNAR_API_FORMAT: 'openai-chat-completions', ACHERNAR_API_KEY: 'isolated-test-secret', NO_COLOR: '1' };
  async function cli(args, expected = 0, cwd = project, input = '') {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [entry, ...args], { cwd, env, windowsHide: true, timeout: 30000 });
      let stdout = '', stderr = '';
      child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
      child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
      child.stdin.end(input);
    });
    assert.equal(result.code, expected, result.stdout + result.stderr);
    assert.equal(result.stderr, '', result.stderr);
    assert.doesNotMatch(result.stdout, /isolated-test-secret|\x1b/);
    return result.stdout.trim();
  }
  try {
    assert.equal(await cli(['--version']), manifest.version); checks.push('version outside source checkout');
    const doctor = JSON.parse(await cli(['--json', 'doctor'])).data;
    assert.equal(doctor.project, fs.realpathSync.native(project)); assert.equal(doctor.ready, true); checks.push('launch cwd and isolated configuration');
    assert.equal(JSON.parse(await cli(['--json', 'inspect'], 1)).error.code, 'PROJECT_NOT_TRUSTED');
    assert.equal(JSON.parse(await cli(['--json', 'run', '--approval', 'auto', '--task-file', 'missing.txt'], 1)).error.code, 'PROJECT_NOT_TRUSTED');
    assert.deepEqual(JSON.parse(await cli(['--trust-project', '--json', 'sessions'])).data, []);
    assert.deepEqual(JSON.parse(await cli(['--json', 'sessions'])).data, []);
    checks.push('first-use trust precedes reads and auto approval; exact project trust survives restart');
    assert.equal(JSON.parse(await cli(['--json', 'settings', 'commandTimeoutMs', '900000'])).data.value, 900000);
    assert.equal(JSON.parse(await cli(['--json', 'settings'])).data.commandTimeoutMs, 900000);
    checks.push('runtime settings persist outside source checkout');
    for (const format of ['--json', '--stream-json']) {
      const result = JSON.parse(await cli([format, 'run'], 1)); assert.equal(result.ok, false);
      if (format === '--stream-json') assert.equal(result.type, 'error');
    }
    checks.push('JSON and JSONL parser errors without plain stderr');
    const taskFile = path.join(root, 'multiline task.txt');
    fs.writeFileSync(taskFile, inputTask);
    for (const [args, input] of [[['--task-file', taskFile], ''], [['--stdin'], inputTask]]) {
      const task = JSON.parse(await cli(['--json', 'run', ...args], 0, project, input));
      assert.equal(task.data.finalContent, 'Multiline code and Unicode input preserved.');
    }
    checks.push('installed file and piped task input preserve multiline code and Unicode');
    const extensions = JSON.parse(await cli(['--json', 'skills'])).data;
    const catalog = JSON.parse(fs.readFileSync(path.join(packageRoot, 'extensions/catalog.json'), 'utf8'));
    assert.equal(extensions.length, catalog.length);
    const skill = JSON.parse(await cli(['--json', 'skills', 'skills/achernar/achernar-ui-design'])).data;
    assert.match(skill.content, /template/);
    const { createCliLibrary } = require(path.join(packageRoot, 'cli/library.js'));
    mcpId = createCliLibrary(packageRoot, home).servers(project, true).find(s => s.name === 'achernar-json-tools')?.id;
    assert.ok(mcpId); checks.push('all bundled Skills and Plugins discoverable');
    assert.ok(!catalog.some(e => /achernar-(computer-use|windows-automation|desktop-pet|appearance|voice-stack)/.test(e.id)));
    for (const file of ['src/services/tools.js', 'src/services/agent-desktop-host.js', 'src/services/computer.js']) assert.ok(!fs.existsSync(path.join(packageRoot, file)), file);
    fs.writeFileSync(path.join(project, 'semantic.ts'), 'export const amount: number = "wrong";\n');
    const diagnostics = JSON.parse(await cli(['--json', 'code', 'diagnostics', 'semantic.ts'])).data;
    assert.ok(diagnostics.diagnostics.some(d => d.code === 2322 && /not assignable/.test(d.message)));
    fs.writeFileSync(path.join(project, 'semantic.ts'), 'export const amount: number = 42;\n');
    assert.deepEqual(JSON.parse(await cli(['--json', 'code', 'diagnostics', 'semantic.ts'])).data.diagnostics, []);
    checks.push('installed real LSP detects and clears compiler errors; desktop code excluded');
    const found = JSON.parse(await cli(['--json', 'search', 'amount\\s*:', '--regex', '--include', '*.{ts,tsx}', '--exclude', '*.test.ts'])).data;
    assert.ok(found.matches.some(m => m.path === 'semantic.ts'));
    checks.push('packaged regex worker and glob dependency execute after npm install');
    const rows = (await cli(['--stream-json', 'run', '--approval', 'auto', 'package-check'])).split('\n').map(line => JSON.parse(line));
    assert.ok(rows.some(r => r.type === 'event' && r.event.type === 'tool_result'));
    const result = rows.at(-1); assert.equal(result.type, 'result'); assert.equal(result.ok, true);
    for (const row of rows.filter(row => row.event?.type === 'status')) assert.doesNotMatch(row.event.message, /[\u3400-\u9fff]/);
    assert.equal(result.data.checkpoint.available, true);
    assert.equal(fs.readFileSync(path.join(project, 'result.txt'), 'utf8'), 'verified-from-standalone-package');
    assert.equal(fs.readFileSync(path.join(project, 'index.html'), 'utf8'), fs.readFileSync(path.join(packageRoot, 'extensions/skills/achernar/achernar-ui-design/assets/templates/workbench.html'), 'utf8'));
    checks.push('real file write, template copy, shell verification, bundled MCP execution and JSONL completion');
    await cli(['--json', 'undo', result.data.sessionId]);
    assert.equal(fs.existsSync(path.join(project, 'result.txt')), false);
    assert.equal(fs.existsSync(path.join(project, 'index.html')), false);
    await cli(['--json', 'redo', result.data.sessionId]);
    assert.equal(fs.readFileSync(path.join(project, 'result.txt'), 'utf8'), 'verified-from-standalone-package');
    const exported = path.join(root, 'shared-session.json');
    await cli(['--json', 'export', result.data.sessionId, exported]);
    const shared = JSON.parse(fs.readFileSync(exported, 'utf8'));
    assert.equal(shared.format, 'achernar-session'); assert.equal(shared.redacted, true);
    assert.doesNotMatch(JSON.stringify(shared), /isolated-test-secret/);
    checks.push('installed task checkpoint undo/redo, redacted export and English JSON system statuses');
    assert.deepEqual(JSON.parse(await cli(['--trust-project', '--json', 'sessions'], 0, root)).data, []);
    assert.equal(JSON.parse(await cli(['--json', 'resume', result.data.sessionId, 'resume-check'], 1, root)).error.code, 'SESSION_NOT_FOUND');
    const resumed = JSON.parse(await cli(['-C', project, '--json', 'resume', result.data.sessionId, 'resume-check'], 0, root));
    assert.match(resumed.data.finalContent, /Resumed/); checks.push('different cwd has isolated history; explicit -C restores the chosen project');
    await cli(['--json', 'run', 'deny-check']);
    await cli(['--json', 'run', '--plan', '--approval', 'auto', 'plan-check']);
    assert.equal(fs.existsSync(path.join(project, 'deny-check.txt')), false);
    assert.equal(fs.existsSync(path.join(project, 'plan-check.txt')), false);
    checks.push('unattended approval refusal and plan mode prevent disk mutations');
    const limited = JSON.parse(await cli(['--json', 'run', '--approval', 'auto', '--max-rounds', '1', 'limit-check'], 1));
    assert.equal(limited.ok, false);
    const sessions = JSON.parse(await cli(['--json', 'sessions'])).data;
    assert.ok(sessions.some(s => s.status === 'failed'));
    const recordFile = id => require(path.join(packageRoot, 'cli/session-records.js')).sessionFile(home, id, project);
    assert.ok(!fs.readdirSync(path.dirname(recordFile(result.data.sessionId))).some(file => file.endsWith('.lock')));
    checks.push('budget exhaustion reports failure, persists recovery and releases session locks');
    assert.equal(typeof require(path.join(packageRoot, 'cli/session-picker.js')).selectSession, 'function');
    await cli(['--json', 'session-delete', result.data.sessionId], 1);
    assert.ok(fs.existsSync(recordFile(result.data.sessionId)));
    const deletion = JSON.parse(await cli(['--json', 'session-delete', result.data.sessionId, '--yes'])).data;
    assert.equal(deletion.deleted, result.data.sessionId);
    assert.equal(deletion.projectFilesPreserved, true);
    assert.equal(fs.existsSync(recordFile(result.data.sessionId)), false);
    assert.equal(fs.readFileSync(path.join(project, 'result.txt'), 'utf8'), 'verified-from-standalone-package');
    checks.push('installed session deletion requires confirmation, removes history and preserves project files');
    const report = { ok: true, version: manifest.version, node: process.version, platform: process.platform, packageRoot, artifacts: root, checks, officialSkills: extensions.filter(e => e.kind === 'skills').length, officialPlugins: extensions.filter(e => e.kind === 'plugins').length, fixtureRequests: requests.length, model: 'local deterministic HTTP fixture; not a quality benchmark' };
    fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
    if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
