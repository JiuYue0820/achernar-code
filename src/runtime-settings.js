(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.runtimeSettings = value;
})(globalThis, () => {
  const fields = {
    retries: { default: 5, min: 0, max: 10, label: '请求重试', labelEn: 'Request retries', unit: '次', unitEn: 'attempts' },
    retryBaseMs: { default: 1000, min: 50, max: 10000, label: '退避起点', labelEn: 'Initial backoff', unit: 'ms' },
    retryMaxMs: { default: 60000, min: 1000, max: 300000, label: '最大退避', labelEn: 'Maximum backoff', unit: 'ms' },
    requestTimeoutMs: { default: 180000, min: 1000, max: 1800000, label: '单次请求时限', labelEn: 'Request deadline', unit: 'ms' },
    commandTimeoutMs: { default: 600000, min: 1000, max: 3600000, label: '默认命令时限', labelEn: 'Command deadline', unit: 'ms' },
    taskTimeoutMs: { default: 1800000, min: 1000, max: 14400000, label: '整项任务时限', labelEn: 'Task deadline', unit: 'ms' },
    autoDiagnostics: { default: true, label: '编辑后自动诊断', labelEn: 'Diagnostics after edits' },
    readCache: { default: true, label: '文件读取缓存', labelEn: 'Version-aware read cache' },
  };
  function normalize(value = {}) {
    // Never silently accept a spending limit or hook permission that is not enforced.
    if (Number(value?.maxTaskUsd) > 0 || value?.hooksEnabled === true) throw new Error('Task cost limits and user hooks are not implemented yet; these settings are not available');
    const result = {};
    for (const [key, field] of Object.entries(fields)) {
      if (value[key] == null) result[key] = field.default;
      else if (typeof field.default === 'boolean') {
        if (typeof value[key] !== 'boolean') throw new Error(`${key} must be boolean`);
        result[key] = value[key];
      } else {
        const n = Number(value[key]);
        if (!Number.isFinite(n) || n < field.min || n > field.max || (!field.fraction && !Number.isInteger(n))) throw new Error(`${key}: ${field.min}–${field.max}`);
        result[key] = n;
      }
    }
    return result;
  }
  return { fields, normalize };
});
