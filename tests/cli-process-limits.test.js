const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { createExecutionEnvironment, executionSettings } = require('../cli/execution-environment');
test('Windows process environment retains OS startup variables without exposing provider keys or Node injection', () => {
  const { windowsProcessEnvironment } = require('../cli/execution-environment');
  const system = { Path: 'system-path', SystemDrive: 'C:', SystemRoot: 'C:\\Windows', USERNAME: 'test-user', USERDOMAIN: 'test-machine', HOMEDRIVE: 'C:', HOMEPATH: '\\Users\\test-user', CommonProgramFiles: 'C:\\Program Files\\Common Files', ProgramW6432: 'C:\\Program Files', PSModulePath: 'system-modules', NUMBER_OF_PROCESSORS: '2' };
  assert.deepEqual(windowsProcessEnvironment({ ...system, ACHERNAR_API_KEY: 'fixture-secret', OPENAI_API_KEY: 'fixture-secret', GH_TOKEN: 'fixture-secret', NODE_OPTIONS: '--require malicious.js' }), system);
});
test('job settings validate real limits and keep host MCP/LSP available', () => {
  assert.throws(() => executionSettings({ sandbox: 'job', jobMemoryMb: 0 }), /memory/i);
  assert.throws(() => executionSettings({ sandbox: 'job', jobProcesses: 0 }), /process/i);
  const env = createExecutionEnvironment({ sandbox: 'job' }, process.cwd());
  assert.equal(env.allowsHostServices, true); assert.match(env.description(), /not.*file|not.*filesystem/i);
});
test('Windows Job Object executes under a real job and kills descendants when its root exits', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  const trace = process.env.ACHERNAR_JOB_TRACE; process.env.ACHERNAR_JOB_TRACE = '1';
  t.after(() => { if (trace == null) delete process.env.ACHERNAR_JOB_TRACE; else process.env.ACHERNAR_JOB_TRACE = trace; });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'achernar-job-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const marker = path.join(root, 'late.txt');
  await fs.writeFile(path.join(root, 'child.cjs'), `setTimeout(()=>require('fs').writeFileSync(process.argv[2],'escaped'),1200);`);
  await fs.writeFile(path.join(root, 'main.cjs'), `const c=require('child_process').spawn(process.execPath,['child.cjs',process.argv[2]],{stdio:'ignore',detached:true});c.unref();console.log('job child '+c.pid);`);
  const env = createExecutionEnvironment({ sandbox: 'job', shell: 'powershell', jobProcesses: 8, jobMemoryMb: 512 }, root);
  const result = await env.run('& node main.cjs late.txt', root, AbortSignal.timeout(45000), 30000, () => {});
  assert.equal(result.timedOut, false, JSON.stringify(result));
  assert.equal(result.exitCode, 0, JSON.stringify(result)); assert.match(result.stdout, /job child \d+/);
  assert.equal(result.isolation, 'windows-job');
  await new Promise(resolve => setTimeout(resolve, 1500));
  await assert.rejects(fs.access(marker), { code: 'ENOENT' });
});
test('Job Object active-process cap prevents launching children with no host fallback', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  const trace = process.env.ACHERNAR_JOB_TRACE; process.env.ACHERNAR_JOB_TRACE = '1';
  t.after(() => { if (trace == null) delete process.env.ACHERNAR_JOB_TRACE; else process.env.ACHERNAR_JOB_TRACE = trace; });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'achernar-job-cap-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const env = createExecutionEnvironment({ sandbox: 'job', shell: 'powershell', jobProcesses: 1, jobMemoryMb: 512 }, root);
  const result = await env.run("node -e \"require('fs').writeFileSync('unexpected.txt','bad')\"", root, AbortSignal.timeout(45000), 30000, () => {});
  assert.equal(result.timedOut, false, JSON.stringify(result));
  await assert.rejects(fs.access(path.join(root, 'unexpected.txt')), { code: 'ENOENT' });
  assert.notEqual(result.exitCode, 0);
});
test('Job Object consumes a complete JSON line without waiting for the parent to close stdin', { skip: process.platform !== 'win32', timeout: 20000 }, async () => {
  const { spawn } = require('node:child_process');
  const helper = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(__dirname, '../cli/windows-job.ps1')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  helper.stdin.on('error', () => {});
  let stdout = '', stderr = '';
  helper.stdout.on('data', data => { stdout += data; }); helper.stderr.on('data', data => { stderr += data; });
  const completed = new Promise((resolve, reject) => { helper.on('error', reject); helper.on('close', code => resolve(code)); });
  helper.stdin.write(JSON.stringify({ ...require('../src/services/commands').shellSpec('echo framed-job-input && node -e "console.log(\'quoted job text\')"', 'cmd'), cwd: process.cwd(), processes: 4, memoryBytes: 512 * 1024 * 1024 }) + '\n');
  let timer;
  try {
    const code = await Promise.race([completed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Complete input frame was blocked waiting for EOF')), 12000); })]);
    assert.equal(code, 0, stderr); assert.match(stdout, /framed-job-input/); assert.match(stdout, /quoted job text/);
  } finally {
    clearTimeout(timer); helper.stdin.end();
    if (helper.exitCode == null) spawn('taskkill.exe', ['/pid', String(helper.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }).on('error', () => helper.kill());
  }
});
