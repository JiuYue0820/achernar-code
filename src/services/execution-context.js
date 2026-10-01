const { createHash } = require('node:crypto');
const digest = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
function excerpt(text, limit = 1600) {
  if (typeof text !== 'string' || text.length <= limit) return text;
  const half = Math.floor(limit / 2);
  return text.slice(0, half) + `\n[${text.length - half * 2} historical characters omitted; sha256:${digest(text)}]\n` + text.slice(-half);
}
function payload(text) {
  return { omitted: 'Historical payload; read the current file or resource before editing. Full tool record remains in the saved session.', characters: text.length, sha256: digest(text) };
}
function argumentsForContext(name, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  return Object.fromEntries(Object.entries(args).map(([key, value]) => {
    if (name === 'files' && ['content', 'oldText'].includes(key) && typeof value === 'string') return [key, payload(value)];
    return [key, typeof value === 'string' && !['path', 'root', 'cwd', 'id', 'resource'].includes(key) ? excerpt(value, 2400) : value];
  }));
}
function resultForContext(name, args, raw) {
  let result = raw;
  if (typeof raw === 'string') {
    try { result = JSON.parse(raw); }
    catch { return excerpt(raw, 2600); }
  }
  if (result == null || typeof result !== 'object') return result;
  if (Array.isArray(result)) return result.length > 40 ? { items: result.slice(0, 40), omittedItems: result.length - 40 } : result;
  const reduced = {};
  for (const [key, value] of Object.entries(result)) {
    // stdout/stderr already carry the command output; avoid repeating merged output.
    if (name === 'terminal' && key === 'output' && ('stdout' in result || 'stderr' in result)) continue;
    if ((name === 'files' && args?.action === 'read' || name === 'skills') && key === 'content' && typeof value === 'string') reduced[key] = payload(value);
    else if (typeof value === 'string') reduced[key] = excerpt(value, ['error', 'message'].includes(key) ? 4000 : 1600);
    else if (Array.isArray(value) && value.length > 40) reduced[key] = { items: value.slice(0, 40), omittedItems: value.length - 40 };
    else reduced[key] = value;
  }
  return reduced;
}
function executionContext(activities) {
  return (activities || []).filter(a => a.result != null).map(({ name, arguments: args, result, failed }) => ({
    name, arguments: argumentsForContext(name, args), result: resultForContext(name, args, result), failed,
  }));
}
module.exports = { executionContext };
