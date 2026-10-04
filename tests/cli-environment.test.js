const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { shellSpec, runCommand } = require('../src/services/commands');
const { executionSettings, dockerSpec, createExecutionEnvironment } = require('../cli/execution-environment');
test('shell selection preserves command text and Unicode and rejects unknown shells', async () => {
  const command = 'Write-Output "hello 世界"';
  assert.equal(shellSpec(command, 'auto', 'win32').command, 'powershell.exe');
  assert.match(Buffer.from(shellSpec(command, 'pwsh').args.at(-1), 'base64').toString('utf16le'), /hello 世界/);
  assert.deepEqual(shellSpec('printf "hello"', 'auto', 'linux'), { command: '/bin/sh', args: ['-c', 'printf "hello"'] });
  assert.throws(() => executionSettings({ shell: 'made-up' }), /Shell/);
  const result = await runCommand(process.platform === 'win32' ? 'Write-Output "hello 世界"' : 'printf "hello 世界"', os.tmpdir(), AbortSignal.timeout(30000)); // cold PowerShell start on busy CI can exceed 10 s
  assert.equal(result.exitCode, 0); assert.match(result.stdout, /hello 世界/);
  if (process.platform === 'win32') {
    const cmd = await runCommand('echo hello-cmd', os.tmpdir(), AbortSignal.timeout(5000), 5000, () => {}, { shell: 'cmd' });
    assert.equal(cmd.exitCode, 0); assert.match(cmd.stdout, /hello-cmd/);
  }
});
test('Docker execution has explicit confinement and never exposes host services or credentials', () => {
  const root = path.resolve('project with spaces'), settings = executionSettings({ sandbox: 'docker' });
  const spec = dockerSpec('node --version', root, path.join(root, 'src'), settings, 'owned-container');
  for (const flag of ['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pull=never', '--pids-limit=128']) assert.ok(spec.args.includes(flag), flag);
  assert.ok(spec.args.includes('/workspace/src')); assert.ok(spec.args.includes(`type=bind,source=${root},target=/workspace`));
  assert.ok(!spec.args.some(arg => /docker.sock|API_KEY|privileged|env-file/.test(arg)));
  assert.equal(createExecutionEnvironment(settings, root).allowsHostServices, false);
  assert.throws(() => dockerSpec('', root, path.dirname(root), settings, 'id'), /within/);
  assert.throws(() => dockerSpec('', root, root, { ...settings, shell: 'powershell' }, 'id'), /Linux/);
  assert.throws(() => executionSettings({ sandbox: 'missing' }), /Sandbox/);
});
test('real Docker isolates host files, network and root filesystem; cancellation removes containers', { skip: process.env.ACHERNAR_TEST_DOCKER !== '1', timeout: 45000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-container-test-')), outside = path.join(path.dirname(root), path.basename(root) + '-secret');
  fs.writeFileSync(outside, 'host-only');
  const env = createExecutionEnvironment({ sandbox: 'docker', sandboxImage: process.env.ACHERNAR_TEST_IMAGE || 'node:24-bookworm-slim' }, root);
  assert.equal((await env.probe()).available, true);
  const script = `const fs=require('fs');fs.writeFileSync('inside.txt','sandbox');if(fs.existsSync(${JSON.stringify(outside)}))process.exit(2);try{fs.writeFileSync('/host-root-write','bad');process.exit(3)}catch{};require('dns').lookup('example.com',e=>process.exit(e?0:4));`;
  const result = await env.run(`node -e '${script.replace(/'/g, "'\\''")}'`, root, AbortSignal.timeout(15000), 12000, () => {});
  assert.equal(result.exitCode, 0); assert.equal(fs.readFileSync(path.join(root, 'inside.txt'), 'utf8'), 'sandbox');
  const canceled = await env.run('sleep 30; touch should-not-exist', root, AbortSignal.timeout(15000), 1000, () => {});
  assert.equal(canceled.timedOut, true); assert.ok(!fs.existsSync(path.join(root, 'should-not-exist')));
  const { runProcess } = require('../src/services/commands');
  const containers = await runProcess('docker', ['ps', '-aq', '--filter', 'name=achernar-'], root, AbortSignal.timeout(5000));
  assert.equal(containers.stdout.trim(), '');
});
