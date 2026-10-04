const fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto');
const { projectPath } = require('./project-path');
const fingerprint = text => createHash('sha256').update(text).digest('hex');

async function snapshot(file) {
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Text edits accept regular files up to 1 MB; use a dedicated binary/file tool for other formats');
    const bytes = await fs.promises.readFile(file);
    if (bytes.includes(0)) throw new Error('Cannot edit binary data with a text file operation');
    return { exists: true, text: bytes.toString('utf8'), revision: fingerprint(bytes) };
  } catch (error) { if (error.code === 'ENOENT') return { exists: false, text: '', revision: null }; throw error; }
}
async function prepareFileMutation(project, args, extensions) {
  if (args.newText != null && args.action !== 'edit') throw new Error('newText is only supported by files.edit; use content for files.write.');
  if (args.newText != null && args.content != null && args.newText !== args.content) throw new Error('content and newText conflict. Supply only one replacement value.');
  if (!['write', 'edit'].includes(args.action)) return null;
  const file = await projectPath(project, args.path);
  if (args.template != null && (args.action !== 'write' || args.content != null || path.extname(file).toLowerCase() !== '.html')) throw new Error('template requires write to a new .html file without content');
  const original = await snapshot(file);
  if (args.template && original.exists) throw new Error('Template destination already exists; read and edit the existing file');
  const replacement = args.content ?? args.newText;
  let after = args.template ? extensions.detail('skills/achernar/achernar-ui-design', `assets/templates/${args.template}.html`).content : replacement;
  if (typeof after !== 'string' || after.length > 200000) throw new Error('文件操作或内容无效');
  if (args.action === 'edit') {
    if (!original.exists || !args.oldText || original.text.split(args.oldText).length !== 2) throw new Error('替换文本必须精确且仅出现一次，请重新读取文件');
    after = original.text.replace(args.oldText, () => replacement);
  }
  const name = args.path.replace(/[\x00-\x1f\x7f]/g, '?');
  const patch = require('diff').createTwoFilesPatch(original.exists ? 'a/' + name : '/dev/null', 'b/' + name, original.text, after, '', '', { context: 3, timeout: 150, maxEditLength: 10000 });
  const truncated = patch == null || patch.length > 60000;
  const preview = { path: args.path, action: args.action, beforeExists: original.exists, beforeBytes: Buffer.byteLength(original.text), afterBytes: Buffer.byteLength(after), truncated,
    diff: patch == null ? '[Diff exceeded preview budget; inspect the proposed content before approving]' : patch.slice(0, 60000) + (truncated ? '\n[Diff preview truncated]' : '') };
  return { file, before: original.text, after, revision: original.revision, beforeExists: original.exists, argumentsKey: JSON.stringify(args), preview };
}
async function applyFileMutation(project, args, change) {
  if (change.argumentsKey !== JSON.stringify(args)) throw new Error('File arguments changed since preview; request a new approval');
  const file = await projectPath(project, args.path);
  const current = await snapshot(file);
  if (file !== change.file || current.revision !== change.revision || current.exists !== change.beforeExists) throw new Error('File changed since preview; read it again and request a new approval');
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, change.after, { encoding: 'utf8', flag: change.beforeExists ? 'w' : 'wx' });
}
module.exports = { prepareFileMutation, applyFileMutation };
