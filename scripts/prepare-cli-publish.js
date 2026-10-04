'use strict';
const fs = require('node:fs/promises'), path = require('node:path');
async function main() {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'cli/package-manifest.json'), 'utf8'));
  const destination = path.resolve(process.argv[2] || `outputs/publish/achernar-code-${manifest.version}`);
  try { await fs.access(destination); throw new Error('Choose a fresh publishing directory; existing work is never overwritten'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const archive = path.join(root, 'outputs/release', manifest.version, `achernar-code-${manifest.version}.zip`);
  const built = await require('../src/services/cli-package').buildCliPackage(root, archive);
  const zip = await require('jszip').loadAsync(await fs.readFile(archive));
  await fs.mkdir(destination, { recursive: true });
  for (const entry of Object.values(zip.files)) {
    const target = path.resolve(destination, entry.name);
    if (!target.startsWith(destination + path.sep)) throw new Error('Invalid package entry');
    if (entry.dir) await fs.mkdir(target, { recursive: true });
    else { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, await entry.async('nodebuffer')); }
  }
  await fs.cp(path.join(root, 'cli/publish'), destination, { recursive: true });
  await fs.mkdir(path.join(destination, 'tests'), { recursive: true });
  for (const name of ['cli-agent-experience', 'cli-commands', 'cli-live-controls', 'cli-model-wizard', 'cli-session-records', 'cli-tui', 'execution-context', 'command-process-safety', 'cli-language-tools', 'cli-environment', 'cli-integration-kit', 'cli-reliability', 'runtime-settings', 'cli-git', 'cli-machine-output', 'cli-model-runtime', 'cli-tool-hooks', 'cli-session-export', 'cli-session-history', 'cli-i18n', 'cli-eval']) await fs.copyFile(path.join(root, 'tests', name + '.test.js'), path.join(destination, 'tests', name + '.test.js'));
  await fs.copyFile(path.join(root, 'scripts/verify-cli-package.js'), path.join(destination, 'scripts/verify-cli-package.js'));
  await fs.copyFile(path.join(root, 'tests/cli-reasoning.test.js'), path.join(destination, 'tests/cli-reasoning.test.js'));
  for (const name of ['cli-projects', 'cli-model-capabilities', 'task-notifications']) await fs.copyFile(path.join(root, 'tests', name + '.test.js'), path.join(destination, 'tests', name + '.test.js'));
  await fs.copyFile(path.join(root, 'docs/cli-model-capabilities.md'), path.join(destination, 'docs/model-capabilities.md'));
  for (const name of ['cli-interaction-upgrade', 'cli-updates', 'cli-engineering', 'cli-release']) await fs.copyFile(path.join(root, 'tests', name + '.test.js'), path.join(destination, 'tests', name + '.test.js'));
  for (const name of ['.editorconfig', '.prettierrc.json', '.prettierignore', 'eslint.config.js']) await fs.copyFile(path.join(root, name), path.join(destination, name));
  for (const name of ['cli-governance', 'cli-governance-integration', 'cli-workbench', 'cli-task-input', 'cli-eval-matrix', 'cli-eval-ci', 'cli-process-limits']) await fs.copyFile(path.join(root, 'tests', name + '.test.js'), path.join(destination, 'tests', name + '.test.js'));
  await fs.chmod(path.join(destination, 'cli/index.js'), 0o755);
  console.log(JSON.stringify({ ...built, directory: destination }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
