const fs = require('node:fs');
const path = require('node:path');

function expandMcpValue(value, variables) {
  if (typeof value === 'string') return value.replace(/\$\{(pluginRoot|appRoot)\}/g, (_match, name) => {
    if (!Object.hasOwn(variables || {}, name)) throw new Error(`MCP 路径变量未提供：${name}`);
    return String(variables[name]);
  });
  if (Array.isArray(value)) return value.map(item => expandMcpValue(item, variables));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandMcpValue(item, variables)]));
  return value;
}

function createExtensionLibrary(root) {
  let catalog, catalogStamp;
  function resolve(relative) {
    const base = fs.realpathSync(root);
    const file = fs.realpathSync(path.resolve(base, relative));
    const rel = path.relative(base, file);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('扩展路径超出资源目录');
    return file;
  }
  function list() {
    if (!fs.existsSync(path.join(root, 'catalog.json'))) return [];
    const file = resolve('catalog.json'), stamp = fs.statSync(file).mtimeMs;
    if (!catalog || catalogStamp !== stamp) { catalog = JSON.parse(fs.readFileSync(file, 'utf8')); catalogStamp = stamp; }
    return catalog.map(item => ({ ...item }));
  }
  function detail(id, resource) {
    const item = list().find(entry => entry.id === id);
    if (!item) throw new Error('扩展不存在');
    const file = resolve(resource ? path.join(item.path, resource) : item.document);
    const resourceRel = path.relative(resolve(item.path), file);
    if (resourceRel === '..' || resourceRel.startsWith('..' + path.sep) || path.isAbsolute(resourceRel)) throw new Error('资源超出此扩展目录');
    if (fs.statSync(file).size > 512 * 1024) throw new Error('扩展文档过大');
    const files = [];
    function walk(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (files.length >= 500) return;
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(target);
        else if (entry.isFile()) files.push(path.relative(resolve(item.path), target).split(path.sep).join('/'));
      }
    }
    walk(resolve(item.path));
    return { ...item, content: fs.readFileSync(file, 'utf8'), files };
  }
  async function importDirectory(directory, kind) {
    if (!['skills', 'plugins'].includes(kind)) throw new Error('未知扩展类型');
    const source = await fs.promises.realpath(directory);
    const document = kind === 'skills' ? 'SKILL.md' : 'README.md';
    if (!fs.existsSync(path.join(source, document))) throw new Error('目录需要包含 ' + document);
    const id = require('node:crypto').randomUUID(), relative = path.join(kind, 'user', id), target = path.join(root, relative);
    let count = 0, bytes = 0;
    await fs.promises.cp(source, target, { recursive: true, dereference: false, filter: async file => {
      if (['node_modules', '.git', '__pycache__'].includes(path.basename(file))) return false;
      const stat = await fs.promises.lstat(file); if (stat.isSymbolicLink()) return false;
      if (stat.isFile()) { bytes += stat.size; if (++count > 2000 || bytes > 50 * 1024 * 1024) throw new Error('扩展最多 2000 文件、50 MB'); }
      return true;
    } });
    const item = { id, name: path.basename(source), kind, source: '用户导入', path: relative.split(path.sep).join('/'), document: path.join(relative, document).split(path.sep).join('/'), description: '', status: kind === 'skills' ? 'imported' : 'adapter-required' };
    const items = [...list(), item];
    await fs.promises.writeFile(path.join(root, 'catalog.json.tmp'), JSON.stringify(items, null, 2)); await fs.promises.rename(path.join(root, 'catalog.json.tmp'), path.join(root, 'catalog.json')); catalog = null;
    return item;
  }
  return { list, detail, importDirectory };
}
module.exports = { createExtensionLibrary, expandMcpValue };
