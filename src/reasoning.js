(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.reasoningConfig = api;
})(globalThis, () => {
  const fields = ['reasoningMode', 'reasoningOptions', 'reasoningLevels', 'reasoningDetected', 'reasoningLevel'];
  function isDeepSeek(input = {}) {
    try { return new URL(input.baseUrl || input.baseURL || '').hostname.toLowerCase() === 'api.deepseek.com'; } catch { return false; }
  }
  function defaults(input) { return options(isDeepSeek(input) ? ['none', 'low', 'high', 'max'] : ['low', 'medium', 'high']); }
  function options(input) {
    const seen = new Set();
    return (Array.isArray(input) ? input : []).slice(0, 32).flatMap(item => {
      const value = typeof item === 'string' ? item : item?.value;
      if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\x00-\x1f\x7f]/.test(value) || seen.has(value.trim())) return [];
      seen.add(value.trim());
      const clean = value.trim();
      const known = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max', ultra: 'Ultra' };
      return [{ value: clean, label: String(item?.label || known[clean.toLowerCase()] || clean).trim().slice(0, 80) }];
    });
  }
  function normalize(input = {}) {
    let mode = ['auto', 'custom', 'off'].includes(input.reasoningMode) ? input.reasoningMode : 'auto';
    let custom = options(input.reasoningOptions);
    const detected = options(input.reasoningLevels);
    const detectedKnown = input.reasoningDetected === true || (Array.isArray(input.reasoningLevels) && input.reasoningLevels.length > 0);
    // Preserve explicit selections from configurations saved before capabilities existed.
    if (!custom.length && !detected.length && mode !== 'off' && !detectedKnown && input.reasoningLevel && input.reasoningLevel !== 'Default' && !defaults(input).some(o => o.value === input.reasoningLevel)) {
      mode = 'custom'; custom = options([...defaults(input), input.reasoningLevel]);
    }
    const supported = mode === 'off' ? [] : mode === 'custom' ? custom : (detectedKnown ? detected : (detected.length ? detected : defaults(input)));
    return { reasoningMode: mode, reasoningOptions: custom, reasoningLevels: detected, reasoningDetected: detectedKnown,
      reasoningLevel: supported.some(o => o.value === input.reasoningLevel) ? input.reasoningLevel : '' };
  }
  function activeOptions(config, input) {
    return config.reasoningMode === 'off' ? [] : config.reasoningMode === 'custom' ? config.reasoningOptions : (config.reasoningDetected ? config.reasoningLevels : (config.reasoningLevels.length ? config.reasoningLevels : defaults(input)));
  }
  function supported(input) { return activeOptions(normalize(input), input); }
  function uiOptions(input) { return supported(input); }
  function select(input, value) {
    const config = normalize(input);
    if (value === '' || /^default$/i.test(value)) return { ...config, reasoningLevel: '' };
    if (!supported(input).some(o => o.value === value)) throw new Error('Reasoning value is not supported or configured for this model. Configure custom levels first.');
    return { ...config, reasoningLevel: value };
  }
  function forModel(current = {}, changes = {}) {
    const merged = { ...current, ...changes }, endpoint = value => String(value || '').replace(/\/+$/, '');
    const changed = merged.modelId !== current.modelId || endpoint(merged.baseUrl) !== endpoint(current.baseUrl) ||
      (merged.apiFormat || 'openai-chat-completions') !== (current.apiFormat || 'openai-chat-completions');
    if (changed) {
      for (const key of fields) delete merged[key];
      for (const key of fields) if (Object.hasOwn(changes, key)) merged[key] = changes[key];
    }
    return normalize(merged);
  }
  function label(input) {
    const config = normalize(input);
    return config.reasoningMode === 'off' ? 'Not sent' : supported(input).find(o => o.value === config.reasoningLevel)?.label || 'Provider default';
  }
  return { options, normalize, supported, uiOptions, select, forModel, label, isDeepSeek };
});
