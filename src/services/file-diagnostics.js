const path = require('node:path');
const supported = file => /\.(?:[cm]?[jt]sx?|json)$/i.test(file);
async function diagnoseFile(project, file, { signal, query } = {}) {
  signal?.throwIfAborted();
  if (!supported(file)) return { status: 'skipped', complete: false, reason: 'No bundled validator for this file type; run the relevant build or test' };
  try {
    const result = query && !/\.json$/i.test(file)
      ? await query({ action: 'diagnostics', path: file, limit: 40 })
      : await require('./diagnostics-pool').runDiagnostics(project, file, { signal });
    signal?.throwIfAborted();
    if (!Array.isArray(result?.diagnostics)) throw new Error('Validator returned no diagnostics');
    return { ...result, status: result.complete === false ? 'unavailable' : 'checked', scope: 'edited-file', hint: 'File diagnostics only; not proof that project tests or builds pass' };
  } catch (error) {
    signal?.throwIfAborted();
    return { status: 'unavailable', complete: false, reason: String(error.message).slice(0, 1000) };
  }
}
module.exports = { diagnoseFile, supported };
