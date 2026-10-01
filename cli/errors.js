'use strict';
const categories = [
  [
    'INVALID_CONFIG',
    /^(?:Invalid|Unknown|Unsupported|Use |Enter |Provide |Configure |Select |Expected |Set |Language must|Reasoning |Update channel)/i,
  ],
  ['SESSION_BUSY', /session.*(?:running|in use)|checkpoint is still running/i],
  ['SESSION_NOT_FOUND', /session not found|no active session|no session checkpoint/i],
  ['CHECKPOINT_CONFLICT', /checkpoint|conversation changed|快照|撤销|恢复/],
  ['APPROVAL_DENIED', /not approved|operation denied|refusal/i],
  ['MODEL_NOT_CONFIGURED', /model ID|Set ACHERNAR_MODEL/i],
  ['NETWORK_ERROR', /fetch failed|network|connection|timed? ?out/i],
  ['UPDATE_ERROR', /update registry|package update|release.*channel/i],
];
/** Map legacy exceptions at the process boundary; explicit service codes win. */
function errorCode(error) {
  if (typeof error.code === 'string' && error.code) return error.code;
  if (error.status)
    return Number(error.status) === 429
      ? 'PROVIDER_RATE_LIMIT'
      : Number(error.status) >= 500
        ? 'PROVIDER_UNAVAILABLE'
        : 'PROVIDER_REQUEST_FAILED';
  if (error.name === 'AbortError') return 'TASK_CANCELED';
  if (error.name === 'TimeoutError') return 'TASK_TIMEOUT';
  return (
    categories.find(([, pattern]) => pattern.test(error.message || String(error)))?.[0] ||
    'ACHERNAR_ERROR'
  );
}
module.exports = { errorCode };
