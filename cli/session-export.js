'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
function redact(value, { secrets = [], paths = [], attachments = false } = {}) {
  const replacements = [
    ...new Set([
      ...secrets.filter(Boolean),
      ...paths.filter(Boolean),
      ...(attachments ? [os.homedir()] : []),
    ]),
  ].sort((a, b) => b.length - a.length);
  function text(value) {
    for (const item of replacements)
      value = value
        .split(item)
        .join('[redacted]')
        .split(item.replace(/\\/g, '/'))
        .join('[redacted]');
    value = value
      .replace(/\bBearer\s+[a-zA-Z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
      .replace(/\b(?:sk-|ghp_|github_pat_)[a-zA-Z0-9_-]{10,}/g, '[redacted]')
      .replace(
        /((?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*)["']?[^"'\s,;]+["']?/gi,
        '$1[redacted]',
      );
    if (attachments)
      value = value
        .replace(
          /data:(?:image|audio|video)\/[^;\s]+;base64,[a-zA-Z0-9+/=]+/g,
          '[attachment omitted]',
        )
        .replace(/\b[A-Z]:[\\/][^"\r\n<>|]+/gi, '[local path]')
        .replace(/(?:\/(?:Users|home|tmp|private|var|mnt)\/)[^\s"'<>]+/g, '[local path]');
    return value;
  }
  function visit(value) {
    if (typeof value === 'string') return text(value);
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /^(?:api[_-]?key|authorization|cookie|password|secret|token|access[_-]?token|refresh[_-]?token|credentialId)$/i.test(
          key,
        )
          ? '[redacted]'
          : attachments &&
              [
                'images',
                'files',
                'credentials',
                'directories',
                'project',
                'checkpoint',
                'pendingUndo',
                'undoStack',
                'redoStack',
              ].includes(key)
            ? '[omitted]'
            : visit(item),
      ]),
    );
  }
  return visit(value);
}
async function exportSession(session, destination, options = {}) {
  const file = path.resolve(destination);
  const safe = redact(session, {
    ...options,
    paths: [session.project, ...(session.directories || []), ...(options.paths || [])],
    attachments: true,
  });
  const document = {
    format: 'achernar-session',
    version: 1,
    exportedAt: new Date().toISOString(),
    redacted: true,
    notice:
      'Review before sharing. Redaction cannot identify every secret or private detail in natural-language text.',
    session: safe,
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Exclusive create protects existing user files; exports never replace history.
  const handle = await fs.open(file, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(document, null, 2));
  } finally {
    await handle.close();
  }
  return { path: file, redacted: true, version: 1 };
}
module.exports = { redact, exportSession };
