const fs = require('node:fs'), path = require('node:path');
async function projectPath(root, relative) {
  const base = await fs.promises.realpath(root);
  const target = path.resolve(base, String(relative || '.'));
  const inside = candidate => { const rel = path.relative(base, candidate); return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
  if (!inside(target)) throw new Error('路径超出当前项目');
  let ancestor = target;
  while (!fs.existsSync(ancestor)) { const parent = path.dirname(ancestor); if (parent === ancestor) throw new Error('路径无效'); ancestor = parent; }
  if (!inside(await fs.promises.realpath(ancestor))) throw new Error('链接指向项目外部');
  return target;
}
module.exports = { projectPath };
