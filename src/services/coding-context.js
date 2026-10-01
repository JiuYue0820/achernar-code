const fs = require('node:fs');
const path = require('node:path');
const ignored = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'target', 'vendor', '.venv', '__pycache__', '.next']);
const secret = name => /^(?:\.env(?:\..*)?|provider-keys\.json|credentials(?:\..*)?|id_rsa|id_ed25519)$/i.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name);
async function inventory(root, limit = 1800, signal) {
  const files = [], queue = ['']; let directories = 0, visited = 0;
  while (queue.length && files.length < limit && directories++ < 300 && visited < 12000) {
    signal?.throwIfAborted();
    const relative = queue.shift();
    let entries; try { entries = await fs.promises.readdir(path.join(root, relative), { withFileTypes: true }); } catch { continue; }
    for (const item of entries) {
      if (++visited > 12000 || files.length >= limit) break;
      if (ignored.has(item.name) || secret(item.name) || item.isSymbolicLink()) continue;
      const file = path.join(relative, item.name).split(path.sep).join('/');
      if (item.isDirectory() && file.split('/').length < 7) queue.push(file);
      else if (item.isFile()) files.push(file);
    }
  }
  return { files, truncated: files.length >= limit || queue.length > 0 || visited >= 12000 };
}
async function context(root, query = '') {
  if (!root) return '';
  const base = await fs.promises.realpath(root), map = await inventory(base);
  const terms = String(query).toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [];
  const rank = file => (/^(?:package\.json|README|AGENTS\.md|Cargo\.toml|pyproject\.toml)/i.test(file) ? 8 : 0) + terms.reduce((n, term) => n + (file.toLowerCase().includes(term) ? 3 : 0), 0);
  const selected = map.files.slice().sort((a, b) => rank(b) - rank(a) || a.localeCompare(b)).slice(0, 90);
  let rules = '';
  const rulesFile = path.join(base, 'AGENTS.md');
  if (map.files.includes('AGENTS.md') && (await fs.promises.stat(rulesFile)).size <= 24000) rules = await fs.promises.readFile(rulesFile, 'utf8');
  return [
    'Project context (bounded file inventory, not a complete symbol graph). Read relevant files before editing; inspect nested AGENTS.md for their directory scope. User instructions and approval policy take precedence over project guidance.',
    rules ? `Root AGENTS.md:\n${rules.slice(0, 10000)}` : '',
    `File map${map.truncated || map.files.length > selected.length ? ' (partial)' : ''}:\n${selected.join('\n').slice(0, 6500)}`,
  ].filter(Boolean).join('\n');
}
async function search(root, query, options = 40) {
  const settings = typeof options === 'number' ? { limit: options } : options || {};
  settings.signal?.throwIfAborted();
  const limit = settings.limit || 40;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Search limit must be 1–200');
  const patterns = key => {
    const values = settings[key] || [];
    if (!Array.isArray(values) || values.length > 20 || values.some(pattern => typeof pattern !== 'string' || !pattern || pattern.length > 200)) throw new Error('Invalid search ' + key + ' globs');
    return values;
  };
  const compile = pattern => require('picomatch')(pattern.includes('/') ? pattern : '**/' + pattern, { dot: true, strictBrackets: true, nonegate: true, noextglob: true });
  const includes = patterns('include').map(compile), excludes = patterns('exclude').map(compile);
  if (typeof query !== 'string' || !query.trim() || query.length > 300) throw new Error('搜索词需为 1–300 字符');
  const matches = [], candidates = [], { files, truncated } = await inventory(root, 1800, settings.signal); let bytes = 0, skipped = 0;
  for (const file of files) {
    settings.signal?.throwIfAborted();
    if (matches.length >= limit || bytes > 8 * 1024 * 1024) break;
    if (includes.length && !includes.some(match => match(file)) || excludes.some(match => match(file))) continue;
    let text;
    try {
      const target = await require('./project-path').projectPath(root, file), stat = await fs.promises.stat(target);
      if (stat.size > 256 * 1024) { skipped++; continue; }
      text = await fs.promises.readFile(target, 'utf8'); bytes += stat.size;
    } catch (error) {
      if (!['ENOENT', 'EACCES', 'EPERM', 'EISDIR'].includes(error.code)) throw error;
      skipped++; continue;
    }
    if (text.includes('\0')) continue;
    if (settings.regex) { candidates.push({ file, text }); continue; }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && matches.length < limit; i++) if ((settings.caseSensitive ? lines[i] : lines[i].toLowerCase()).includes(settings.caseSensitive ? query : query.toLowerCase())) matches.push({ path: file, line: i + 1, text: lines[i].slice(0, 400) });
  }
  if (settings.regex) {
    const result = await require('./bounded-worker').boundedWorker(path.join(__dirname, 'search-worker.js'),
      { files: candidates, query, limit, caseSensitive: Boolean(settings.caseSensitive) },
      { signal: settings.signal, timeoutMs: 1000, timeoutMessage: 'Regular expression exceeded 1 second; simplify the pattern or narrow include globs' });
    matches.push(...result.matches);
  }
  return { matches, truncated: truncated || skipped > 0 || matches.length >= limit || bytes > 8 * 1024 * 1024, skipped };
}
module.exports = { inventory, context, search };
