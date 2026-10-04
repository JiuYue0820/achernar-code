const fs = require('node:fs/promises');
const { projectPath } = require('./project-path');

function createFileDrafts(project, emit, signal, extensions) {
  const versions = new Map(), originals = new Map();
  return async (callId, args, complete = false) => {
    if (!project || !['write', 'edit'].includes(args.action) || typeof args.path !== 'string' || !args.path) return;
    const version = (versions.get(callId) || 0) + 1; versions.set(callId, version);
    try {
      const file = await projectPath(project, args.path);
      let text = args.content;
      if (complete && args.action === 'write' && args.content == null && ['workbench', 'data-overview', 'editorial'].includes(args.template) && /\.html$/i.test(file)) {
        // Copy previews do not write; denied operations never create a file.
        try { await fs.stat(file); return; } catch (error) { if (error.code !== 'ENOENT') return; }
        text = extensions?.detail('skills/achernar/achernar-ui-design', `assets/templates/${args.template}.html`).content;
      }
      if (args.action === 'edit') {
        if (typeof args.oldText !== 'string' || !args.oldText || typeof args.content !== 'string') return;
        if (!originals.has(file)) originals.set(file, fs.readFile(file, 'utf8'));
        const before = await originals.get(file), index = before.indexOf(args.oldText);
        if (index < 0 || before.indexOf(args.oldText, index + 1) !== -1) return;
        text = before.slice(0, index) + args.content + before.slice(index + args.oldText.length);
      }
      if (typeof text !== 'string' || versions.get(callId) !== version || signal.aborted) return;
      emit({ type: 'file_draft', callId, path: args.path, text: text.slice(0, 200000), complete });
    } catch { /* Invalid paths and edits are reported by execution; previews never write. */ }
  };
}
module.exports = { createFileDrafts };
