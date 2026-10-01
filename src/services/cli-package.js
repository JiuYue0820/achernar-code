const fs = require('node:fs/promises'), path = require('node:path');
async function buildCliPackage(root, output) {
  const JSZip = require('jszip'), zip = new JSZip();
  const files = ['cli/index.js', 'cli/README.md', 'src/runtime-settings.js', 'src/agent-commands.js', 'src/reasoning.js', 'src/provider-formats.js', ...['agent-core', 'agent-workflow', 'coding-context', 'providers', 'llm-protocols', 'core-tools', 'project-path', 'commands', 'approval', 'extensions', 'mcp', 'file-drafts', 'subagents'].map(name => `src/services/${name}.js`), 'extensions/plugins/achernar/achernar-web-search/search.js'];
  files.push('src/services/task-notifications.js', 'src/services/windows-notifications.js', 'src/services/windows-notifications.ps1');
  files.push('src/services/execution-context.js');
  files.push(...['search-worker', 'bounded-worker', 'file-mutation', 'file-diagnostics', 'diagnostics-worker'].map(name => `src/services/${name}.js`));
  files.push('src/services/turn-history.js');
  files.push(...['git-tools', 'machine-output', 'model-runtime', 'tool-hooks', 'session-export', 'session-history', 'governance-menu', 'i18n'].map(name => `cli/${name}.js`));
  files.push(...['tasks', 'report', 'index', 'matrix', 'ci'].map(name => `cli/eval/${name}.js`));
  files.push('cli/session-records.js');
  files.push('src/model-capabilities.js');
  files.push('cli/workbench-commands.js');
  files.push('cli/reasoning-menu.js');
  files.push('cli/task-input.js');
  files.push('cli/windows-job.ps1');
  files.push('cli/agent-policy.js', 'cli/task-inbox.js', 'cli/task-report.js');
  files.push('cli/agent-question.js');
  // Every top-level CLI module is runtime code. Include new modules here by
  // inventory; an explicit shared-services allowlist keeps desktop code out.
  for (const entry of await fs.readdir(path.join(root, 'cli'), { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith('.js')) files.push('cli/' + entry.name);
  zip.file('src/services/agent.js', "module.exports = require('./agent-core');\n");
  for (const file of new Set(files)) zip.file(file, await fs.readFile(path.join(root, file)));
  for (const file of ['banner', 'workspace', 'library', 'credentials', 'model-wizard', 'live-controls', 'manage-integrations', 'chat-commands', 'tui', 'tui-text', 'tui-metrics', 'tui-input', 'tui-output', 'tui-art', 'tui-screen'].map(name => `cli/${name}.js`)) zip.file(file, await fs.readFile(path.join(root, file)));
  for (const name of ['extension-policy', 'lsp-client', 'language-tools', 'execution-environment', 'integration-kit', 'runtime-menu']) zip.file(`cli/${name}.js`, await fs.readFile(path.join(root, 'cli', `${name}.js`)));
  const catalog = JSON.parse(await fs.readFile(path.join(root, 'extensions/catalog.json'), 'utf8')).filter(require('../../cli/extension-policy').isCliExtension);
  async function addFolder(relative, target = relative) { for (const item of await fs.readdir(path.join(root, relative), { withFileTypes: true })) { if (item.isSymbolicLink()) continue; const file = relative + '/' + item.name, zipped = target + '/' + item.name; if (item.isDirectory()) await addFolder(file, zipped); else zip.file(zipped, await fs.readFile(path.join(root, file))); } }
  for (const entry of catalog) await addFolder('extensions/' + entry.path);
  await addFolder('extensions/lib');
  await addFolder('cli/publish/docs', 'docs');
  zip.file('extensions/catalog.json', JSON.stringify(catalog, null, 2));
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'cli/package-manifest.json'), 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(root, 'cli/dependency-lock.json'), 'utf8'));
  const locked = lock.packages?.['']?.dependencies || {};
  if (Object.keys(manifest.dependencies).length !== Object.keys(locked).length || Object.entries(manifest.dependencies).some(([name, version]) => locked[name] !== version) || manifest.version !== lock.version || manifest.name !== lock.name) throw new Error('CLI manifest and dependency lock differ; regenerate the lock before packaging');
  const lockedDev = lock.packages?.['']?.devDependencies || {}, dev = manifest.devDependencies || {};
  if (Object.keys(dev).length !== Object.keys(lockedDev).length || Object.entries(dev).some(([name, version]) => lockedDev[name] !== version)) throw new Error('CLI development dependencies and lock differ; regenerate the lock before packaging');
  zip.file('package.json', JSON.stringify(manifest, null, 2));
  zip.file('package-lock.json', JSON.stringify(lock, null, 2));
  zip.file('LICENSE', await fs.readFile(path.join(root, 'cli/publish/LICENSE')));
  zip.file('THIRD_PARTY_NOTICES.md', await fs.readFile(path.join(root, 'cli/THIRD_PARTY_NOTICES.md')));
  zip.file('README.md', await fs.readFile(path.join(root, 'cli/publish/README.md')));
  zip.file('README.zh-CN.md', await fs.readFile(path.join(root, 'cli/publish/README.zh-CN.md')));
  zip.file('USAGE.md', await fs.readFile(path.join(root, 'cli/README.md')));
  zip.file('RELEASE_NOTES.md', await fs.readFile(path.join(root, 'docs/releases', manifest.version + '.md')));
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return { path: output, bytes: (await fs.stat(output)).size, version: manifest.version, sha256: require('node:crypto').createHash('sha256').update(await fs.readFile(output)).digest('hex') };
}
module.exports = { buildCliPackage };
