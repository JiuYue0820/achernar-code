const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { spawn } = require('node:child_process');
test('real CLI routes native Git, hooks, restricted writes, English JSON, undo/redo and redacted export', { timeout: 30000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'achernar-cli-governance-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project'), home = path.join(root, 'home');
  await fs.mkdir(project); await fs.mkdir(home); await fs.mkdir(path.join(project, 'src'));
  await fs.writeFile(path.join(project, 'src', 'note.txt'), 'before');
  const requests = [], seen = [];
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const data of req) text += data;
    const body = JSON.parse(text); requests.push(body);
    const results = body.messages.filter(m => m.role === 'tool');
    if (results.length) seen.push(...results.map(m => JSON.parse(m.content)));
    const args = [
      ['files', { action: 'write', path: 'outside.txt', content: 'blocked' }],
      ['terminal', { command: 'exit 0', reason: 'pretend success' }],
      ['files', { action: 'edit', path: 'src/note.txt', oldText: 'before', content: 'after' }],
      ['git', { action: 'status' }],
    ];
    const message = results.length ? { content: '中文结果保持原样' } : { tool_calls: args.map(([name, args], i) => ({ id: 'c' + i, type: 'function', function: { name, arguments: JSON.stringify(args) } })) };
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 100, completion_tokens: 10 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const env = { ...process.env, ACHERNAR_CLI_HOME: home, ACHERNAR_MODEL: 'integration-fixture', ACHERNAR_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, ACHERNAR_API_FORMAT: 'openai-chat-completions', ACHERNAR_API_KEY: 'private-fixture-key', ACHERNAR_NOTIFICATIONS: '0' };
  const hook = path.join(root, 'hook.js');
  await fs.writeFile(hook, "let text='';process.stdin.on('data',v=>text+=v);process.stdin.on('end',()=>{const p=JSON.parse(text);require('fs').appendFileSync(process.argv[2],p.name+'\\n');console.log('{}');});");
  await fs.writeFile(path.join(home, 'config.json'), JSON.stringify({ modelId: env.ACHERNAR_MODEL, baseUrl: env.ACHERNAR_BASE_URL, apiFormat: env.ACHERNAR_API_FORMAT, sandbox: 'restricted', writePaths: ['src'], pricing: { input: 0, output: 0 }, maxCost: .01, hooks: { tool_pre: [{ command: process.execPath, args: [hook, path.join(root, 'hooks.log')] }] } }));
  const cli = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../cli/index.js'), '--trust-project', '-C', project, ...args], { env, windowsHide: true, timeout: 15000 });
    let stdout = '', stderr = ''; child.stdout.on('data', bytes => stdout += bytes); child.stderr.on('data', bytes => stderr += bytes);
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr })); child.stdin.end();
  });
  const run = await cli(['--stream-json', 'run', '--approval', 'auto', 'Verify controls']);
  assert.equal(run.code, 0, run.stdout + run.stderr);
  const rows = run.stdout.trim().split('\n').map(JSON.parse), final = rows.at(-1).data;
  assert.equal(final.finalContent, '中文结果保持原样');
  assert.ok(requests[0].tools.some(tool => tool.function.name === 'git'));
  assert.ok(seen.some(result => /write allowlist/.test(result.error))); assert.ok(seen.some(result => /no-op/.test(result.error)));
  assert.equal(await fs.readFile(path.join(project, 'src/note.txt'), 'utf8'), 'after');
  for (const row of rows.filter(row => row.event?.type === 'status')) assert.doesNotMatch(row.event.message, /[\u3400-\u9fff]/);
  assert.match(await fs.readFile(path.join(root, 'hooks.log'), 'utf8'), /files\ngit/);
  const undo = await cli(['--json', 'undo', final.sessionId]); assert.equal(undo.code, 0, undo.stdout);
  assert.equal(await fs.readFile(path.join(project, 'src/note.txt'), 'utf8'), 'before');
  const redo = await cli(['--json', 'redo', final.sessionId]); assert.equal(redo.code, 0, redo.stdout);
  assert.equal(await fs.readFile(path.join(project, 'src/note.txt'), 'utf8'), 'after');
  const exported = path.join(root, 'export.json');
  assert.equal((await cli(['--json', 'export', final.sessionId, exported])).code, 0);
  const share = await fs.readFile(exported, 'utf8'); assert.doesNotMatch(share, /private-fixture-key/); assert.ok(!share.includes(project.replace(/\\/g, '\\\\')));
});
test('hooks observe workspace and mode controls and can block delegation before any child request', { timeout: 30000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'achernar-control-hooks-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project'), home = path.join(root, 'home'), log = path.join(root, 'hooks.jsonl');
  await fs.mkdir(project); await fs.mkdir(home);
  const hook = path.join(root, 'hook.js');
  await fs.writeFile(hook, `let text='';process.stdin.on('data',v=>text+=v);process.stdin.on('end',()=>{
    const p=JSON.parse(text);require('fs').appendFileSync(process.argv[2],JSON.stringify(p)+'\\n');
    const deny=p.event==='tool_pre'&&(p.name==='delegate'||p.name==='execution_mode'&&p.arguments.mode==='code');
    console.log(JSON.stringify(deny?{decision:'deny',message:'Blocked by control policy'}:{}));
  });`);
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain fixture request */ }
    const actions = [
      ['workspace', { action: 'list' }],
      ['delegate', { tasks: [{ role: 'researcher', task: 'Inspect the workspace' }] }],
      ['execution_mode', { mode: 'review', reason: 'Review only' }],
      ['execution_mode', { mode: 'code', reason: 'Attempt to write' }],
      ['files', { action: 'write', path: 'unexpected.txt', content: 'must not happen' }],
    ];
    const message = calls++ === 0 ? { tool_calls: actions.map(([name, args], i) => ({ id: 'control' + i, type: 'function', function: { name, arguments: JSON.stringify(args) } })) } : { content: 'Control fixture complete' };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 100, completion_tokens: 10 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const entry = { command: process.execPath, args: [hook, log] };
  await fs.writeFile(path.join(home, 'config.json'), JSON.stringify({ modelId: 'control-fixture', baseUrl, hooks: { tool_pre: [entry], tool_post: [entry] } }));
  const execution = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(__dirname, '../cli/index.js'), '--trust-project', '-C', project, '--stream-json', 'run', '--agents', '--approval', 'auto', 'Verify control hooks'], {
      windowsHide: true, timeout: 20000, env: { ...process.env, ACHERNAR_CLI_HOME: home, ACHERNAR_MODEL: 'control-fixture', ACHERNAR_BASE_URL: baseUrl, ACHERNAR_API_FORMAT: 'openai-chat-completions', ACHERNAR_API_KEY: 'fixture-key', ACHERNAR_NOTIFICATIONS: '0' },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr })); child.stdin.end();
  });
  assert.equal(execution.code, 0, execution.stdout + execution.stderr);
  assert.equal(calls, 2, 'denied delegation must not start a child model request');
  await assert.rejects(fs.access(path.join(project, 'unexpected.txt')));
  const payloads = (await fs.readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(payloads.map(p => [p.event, p.name]), [
    ['tool_pre', 'workspace'], ['tool_post', 'workspace'], ['tool_pre', 'delegate'],
    ['tool_pre', 'execution_mode'], ['tool_post', 'execution_mode'], ['tool_pre', 'execution_mode'],
  ]);
  assert.equal(payloads.find(p => p.event === 'tool_post' && p.name === 'execution_mode').result.mode, 'review');
});
