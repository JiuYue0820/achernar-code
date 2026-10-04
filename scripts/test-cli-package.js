'use strict';
// Exercise an extracted release outside this checkout, so dependencies cannot
// accidentally resolve from the desktop application's node_modules.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-cli-release-'));
const distribution = path.join(scratch, 'distribution');
if (!process.env.npm_execpath) throw new Error('Run through npm run test:cli-package');
function run(script, args, cwd) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd, env: { ...process.env, NODE_PATH: '', ACHERNAR_NOTIFICATIONS: '0' },
    windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180000,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) throw result.error || new Error(`Package check failed (${result.status}): ${args.join(' ')}`);
}
try {
  run(path.join(root, 'scripts/prepare-cli-publish.js'), [distribution], root);
  run(process.env.npm_execpath, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], distribution);
  run(process.env.npm_execpath, ['run', 'lint'], distribution);
  run(process.env.npm_execpath, ['run', 'format:check'], distribution);
  run(process.env.npm_execpath, ['test'], distribution);
  run(process.env.npm_execpath, ['run', 'test:package'], distribution);
  console.log(JSON.stringify({ ok: true, distribution }));
} catch (error) { console.error(error.message); console.error('Package check artifacts:', scratch); process.exitCode = 1; }
