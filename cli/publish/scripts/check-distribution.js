'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-distribution-'));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this check through npm run test:package');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env: { ...process.env, ACHERNAR_NOTIFICATIONS: '0' }, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr + result.stdout);
  return result.stdout;
}
const packed = JSON.parse(run(process.execPath, [npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', scratch]))[0];
const bad = packed.files.filter(file => /(^|\/)(?:tests|scripts|\.git|\.github|outputs?|node_modules)\//.test(file.path) || /(^|\/)(?:\.env(?:\.|$)|\.npmrc$|credentials\.json$)/.test(file.path));
if (bad.length) throw new Error('Unexpected published files: ' + bad.map(file => file.path).join(', '));
const required = ['cli/index.js', 'cli/task-input.js', 'cli/workbench-commands.js', 'cli/updates.js', 'cli/update-menu.js', 'cli/settings-save.js', 'cli/reasoning-menu.js', 'cli/model-picker.js', 'cli/i18n-extra.js', 'cli/tui-selection.js', 'cli/windows-job.ps1', 'cli/eval/ci.js', 'src/services/windows-notifications.ps1', 'extensions/catalog.json', 'USAGE.md', 'LICENSE'];
for (const file of required) if (!packed.files.some(entry => entry.path === file)) throw new Error('Missing package resource: ' + file);
for (const file of ['src/services/tools.js', 'src/services/agent-desktop-host.js', 'src/services/computer.js', 'src/services/memory.js']) if (packed.files.some(entry => entry.path === file)) throw new Error('Desktop implementation leaked into CLI package: ' + file);
for (const file of ['main.js', 'preload.js', 'index.html', 'src/renderer.js']) if (packed.files.some(entry => entry.path === file)) throw new Error('Desktop application leaked into CLI package: ' + file);
const prefix = path.join(scratch, 'install');
run(process.execPath, [npm, 'install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', path.join(scratch, packed.filename)]);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const installed = path.join(prefix, 'node_modules', manifest.name);
console.log(run(process.execPath, [path.join(__dirname, 'verify-cli-package.js'), installed]));
console.log(JSON.stringify({ packed: packed.filename, tarball: path.join(scratch, packed.filename), entries: packed.files.length, bytes: packed.size, sha512: packed.integrity, packageInstalledAndVerified: true }));
