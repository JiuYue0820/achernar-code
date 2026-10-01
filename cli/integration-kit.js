'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { createHash } = require('node:crypto');
const digest = (data) => createHash('sha256').update(data).digest('hex');
function vscodeTasks() {
  return ['chat', 'review', 'inspect'].map((command) => ({
    label: `Achernar: ${command}`,
    type: 'process',
    command: 'achernar',
    args: ['-C', '${workspaceFolder}', command],
    problemMatcher: [],
    presentation: { reveal: 'always', panel: 'dedicated', focus: command === 'chat' },
  }));
}
async function setupVscode(root, write = false) {
  const file = await require('../src/services/project-path').projectPath(
    root,
    '.vscode/tasks.json',
  );
  let current = { version: '2.0.0', tasks: [] };
  if (fs.existsSync(file)) {
    try {
      current = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      throw new Error(
        'Existing tasks.json contains comments or invalid JSON. Merge the preview tasks manually; the file was not changed.',
      );
    }
    if (!Array.isArray(current.tasks))
      throw new Error('Existing tasks.json has no tasks array; merge manually.');
  }
  const labels = new Set(current.tasks.map((task) => task.label));
  const added = vscodeTasks().filter((task) => !labels.has(task.label));
  const result = { ...current, tasks: [...current.tasks, ...added] };
  if (write && added.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
  }
  return {
    file,
    written: Boolean(write && added.length),
    added: added.map((task) => task.label),
    tasks: result,
    note: 'VS Code task integration; not a marketplace extension. achernar must be on PATH. Existing tasks are preserved.',
  };
}
async function packExtension(directory, kind, output) {
  if (!['skills', 'plugins'].includes(kind)) throw new Error('Kind must be skills or plugins');
  const root = fs.realpathSync(directory),
    entry = kind === 'skills' ? 'SKILL.md' : 'README.md';
  if (!fs.statSync(path.join(root, entry)).isFile()) throw new Error('Extension needs ' + entry);
  const files = [];
  let bytes = 0;
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink() || ['.git', 'node_modules', '__pycache__'].includes(item.name))
        continue;
      const full = path.join(dir, item.name),
        relative = path.relative(root, full).split(path.sep).join('/');
      if (/(^|\/)(?:\.env(?:\..*)?|\.npmrc|credentials\.json|.*\.(?:pem|key))$/i.test(relative))
        throw new Error(
          'Remove private configuration from the extension before packing: ' + relative,
        );
      if (item.isDirectory()) walk(full);
      else if (item.isFile()) {
        const stat = fs.statSync(full);
        bytes += stat.size;
        if (files.length >= 1000 || bytes > 5 * 1024 * 1024)
          throw new Error('Extension bundle limit: 1000 files / 5 MB');
        const data = fs.readFileSync(full);
        files.push({ path: relative, data: data.toString('base64'), sha256: digest(data) });
      }
    }
  }
  walk(root);
  const payload = {
    format: 'achernar-extension',
    version: 1,
    name: path.basename(root),
    kind,
    files,
  };
  const body = JSON.stringify(payload);
  if (output) fs.writeFileSync(path.resolve(output), body + '\n', { flag: 'wx' });
  return {
    name: payload.name,
    kind,
    files: files.length,
    bytes,
    sha256: digest(body + '\n'),
    ...(output ? { path: path.resolve(output) } : {}),
    payload: output ? undefined : payload,
  };
}
async function importBundle(filename, library) {
  const stat = fs.statSync(filename);
  if (stat.size > 8 * 1024 * 1024) throw new Error('Extension bundle exceeds 8 MB');
  const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (
    data.format !== 'achernar-extension' ||
    data.version !== 1 ||
    !['skills', 'plugins'].includes(data.kind) ||
    !Array.isArray(data.files) ||
    !data.files.length ||
    data.files.length > 1000
  )
    throw new Error('Invalid extension bundle');
  const paths = new Set();
  let size = 0;
  const files = data.files.map((file) => {
    if (
      typeof file.path !== 'string' ||
      file.path.length > 500 ||
      file.path
        .split('/')
        .some(
          (part) =>
            !part ||
            part === '.' ||
            part === '..' ||
            /[\\:\x00-\x1f<>"|?*]/.test(part) ||
            /[ .]$/.test(part) ||
            /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(part),
        )
    )
      throw new Error('Unsafe bundle path');
    if (paths.has(file.path.toLowerCase())) throw new Error('Duplicate bundle path');
    paths.add(file.path.toLowerCase());
    if (
      typeof file.data !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)
    )
      throw new Error('Invalid bundle encoding');
    const bytes = Buffer.from(file.data, 'base64');
    size += bytes.length;
    if (size > 5 * 1024 * 1024 || digest(bytes) !== file.sha256)
      throw new Error('Bundle content hash mismatch or size limit exceeded');
    return { path: file.path, bytes };
  });
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-extension-'));
  const name =
    typeof data.name === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(data.name)
      ? data.name
      : 'imported-extension';
  const root = path.join(staging, name);
  fs.mkdirSync(root);
  try {
    for (const file of files) {
      const target = path.join(root, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.bytes, { flag: 'wx' });
    }
    return await library.importExtension(root, data.kind);
  } finally {
    // Both paths are generated by this function, with no links or user-supplied absolute paths.
    const resolved = fs.realpathSync(staging);
    if (
      path.dirname(resolved) === fs.realpathSync(os.tmpdir()) &&
      path.basename(resolved).startsWith('achernar-extension-')
    )
      fs.rmSync(resolved, { recursive: true, force: true });
  }
}
module.exports = { setupVscode, packExtension, importBundle };
