'use strict';

// Rebuild the project-local extension catalog. Only first-party resources and
// explicitly imported user directories are discoverable; no external host
// marketplace is copied into this workspace.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'extensions');
const catalogFile = path.join(root, 'catalog.json');
const ignored = new Set(['node_modules', '.git', '__pycache__', '.DS_Store', '.env', 'credentials.json']);
const portable = file => path.relative(root, file).split(path.sep).join('/');
const entries = [];

function isDirectory(target) {
  try { return fs.statSync(target).isDirectory(); } catch { return false; }
}

function register(item) {
  if (!entries.some(entry => entry.id === item.id)) entries.push(item);
}

function sourceFor(relative) {
  const first = relative.split('/')[1];
  return first === 'achernar' ? 'Achernar Project' : first === 'user' ? '用户导入' : null;
}

function scanSkillDirectory(directory, source) {
  if (!isDirectory(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.startsWith('.')) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) scanSkillDirectory(target, source);
  }
  const document = path.join(directory, 'SKILL.md');
  if (fs.existsSync(document)) {
    register({
      id: portable(directory),
      kind: 'skills',
      name: path.basename(directory),
      source,
      path: portable(directory),
      document: portable(document),
      status: 'imported',
      description: 'Achernar Skill instructions'
    });
  }
}

function scanSkills() {
  for (const bucket of ['achernar', 'user']) {
    const directory = path.join(root, 'skills', bucket);
    if (isDirectory(directory)) scanSkillDirectory(directory, sourceFor(`skills/${bucket}`));
  }
}

function scanPlugins() {
  for (const bucket of ['achernar', 'user']) {
    const directory = path.join(root, 'plugins', bucket);
    if (!isDirectory(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || ignored.has(entry.name) || entry.name.startsWith('.')) continue;
      const pluginRoot = path.join(directory, entry.name);
      const manifestFile = path.join(pluginRoot, '.codex-plugin', 'plugin.json');
      if (!fs.existsSync(manifestFile)) continue;
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { continue; }
      const readme = path.join(pluginRoot, 'README.md');
      register({
        id: portable(pluginRoot),
        kind: 'plugins',
        name: manifest.name || entry.name,
        version: manifest.version || '0.0.0',
        source: sourceFor(`plugins/${bucket}`),
        path: portable(pluginRoot),
        document: portable(fs.existsSync(readme) ? readme : manifestFile),
        status: bucket === 'achernar' ? 'ready' : 'adapter-required',
        description: manifest.description || ''
      });
    }
  }
}

scanPlugins();
scanSkills();
entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(catalogFile, JSON.stringify(entries, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ plugins: entries.filter(item => item.kind === 'plugins').length, skills: entries.filter(item => item.kind === 'skills').length, catalogFile }));
