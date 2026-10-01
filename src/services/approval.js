function needsApproval(mode, name, args = {}) {
  if (name === 'plan' || name === 'ask_user') return false;
  if (mode === 'all') return false;
  if (mode === 'computer' && (name === 'computer' || name === 'browser')) return false;
  // Only simple, known read-only commands bypass confirmation in CMD mode.
  if (mode === 'cmd' && name === 'terminal') {
    const command = String(args.command || '').trim();
    return !/^(?:pwd|ls|dir|Get-Location|Get-ChildItem|git\s+(?:status|diff|log)|rg|node\s+--version|npm\s+--version)(?:\s+[\w .\-/]*)?$/i.test(command);
  }
  return true;
}
function createApprovalBroker({ onRequest = () => {} } = {}) {
  const pending = new Map();
  function request(payload, signal, emit) {
    signal.throwIfAborted();
    const id = require('node:crypto').randomUUID();
    return new Promise((resolve, reject) => {
      const waiting = new AbortController();
      const cleanup = () => { pending.delete(id); signal.removeEventListener('abort', abort); waiting.abort(); };
      const abort = () => { cleanup(); reject(signal.reason); };
      pending.set(id, { type: payload.type, payload, emit, resolve: answer => { cleanup(); resolve(answer); } });
      signal.addEventListener('abort', abort, { once: true }); emit({ ...payload, id });
      Promise.resolve().then(() => { if (pending.has(id)) return onRequest(payload, id, waiting.signal); }).catch(() => {});
    });
  }
  function answer(id, value) { const entry = pending.get(id); if (!entry) return false; entry.emit({ type: 'request_resolved', id, ...value }); entry.resolve(value); return true; }
  function applyMode(mode) {
    for (const [id, entry] of pending) if (entry.type === 'approval' && !needsApproval(mode, entry.payload.tool, entry.payload.arguments)) {
      entry.emit({ type: 'approval_resolved', id, approved: true }); entry.resolve({ approved: true });
    }
  }
  return { request, answer, applyMode, has: (id, type) => pending.get(id)?.type === type };
}
module.exports = { needsApproval, createApprovalBroker };
