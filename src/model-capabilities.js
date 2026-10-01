'use strict';
// Verified 2026-09-27. Exact IDs only: never infer limits from a model-name substring.
// Sources and alias decisions are recorded in docs/cli-model-capabilities.md.
const catalog = new Map();
function add(family, ids, contextWindow, maxOutputTokens, levels, source) {
  for (const id of ids) catalog.set(family + '/' + id, { contextWindow, maxOutputTokens,
    maxInputTokens: contextWindow - 1, reasoningLevels: levels, source, checkedAt: '2026-09-27' });
}
const openai = id => 'https://developers.openai.com/api/docs/models/' + id;
add('openai', ['gpt-5'], 400000, 128000, ['minimal', 'low', 'medium', 'high'], openai('gpt-5'));
add('openai', ['gpt-5.1'], 400000, 128000, ['none', 'low', 'medium', 'high'], openai('gpt-5.1'));
add('openai', ['gpt-5.4', 'gpt-5.5'], 1050000, 128000, ['none', 'low', 'medium', 'high', 'xhigh'], openai('gpt-5.4'));
catalog.get('openai/gpt-5.5').source = openai('gpt-5.5');
add('openai', ['gpt-5.4-mini'], 400000, 128000, ['none', 'low', 'medium', 'high', 'xhigh'], openai('gpt-5.4-mini'));
add('openai', ['o3', 'codex-mini-latest'], 200000, 100000, ['low', 'medium', 'high'], openai('o3'));
catalog.get('openai/codex-mini-latest').source = openai('codex-mini-latest');
add('deepseek', ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4-pro'], 1048576, 393216, ['none', 'low', 'high', 'max'], 'https://api-docs.deepseek.com/api/create-chat-completion');

function capabilities(input = {}) {
  let hostname;
  try { hostname = new URL(input.baseUrl || '').hostname.toLowerCase(); } catch { return null; }
  const family = { 'api.openai.com': 'openai', 'api.deepseek.com': 'deepseek' }[hostname];
  let value = family && catalog.get(family + '/' + input.modelId);
  // OpenRouter uses explicit upstream prefixes, but proxy-specific metadata wins.
  if (hostname === 'openrouter.ai') value = catalog.get(input.modelId);
  return value ? structuredClone(value) : null;
}
function applyCapabilities(input = {}) {
  const known = capabilities(input);
  if (!known) return { ...input };
  const custom = input.limitsMode === 'custom';
  const result = { ...input,
    ...(!custom ? { contextWindow: known.contextWindow, maxInputTokens: known.maxInputTokens, maxOutputTokens: known.maxOutputTokens } : {}),
    maxModelOutputTokens: known.maxOutputTokens,
    capabilitySource: known.source, capabilityCheckedAt: known.checkedAt,
  };
  if (input.reasoningMode !== 'custom') {
    result.reasoningLevels = known.reasoningLevels;
    result.reasoningDetected = true;
  }
  return result;
}
function forModel(current = {}, changes = {}) {
  const merged = { ...current, ...changes }, endpoint = value => String(value || '').replace(/\/+$/, '');
  if (merged.modelId !== current.modelId || endpoint(merged.baseUrl) !== endpoint(current.baseUrl) || (merged.apiFormat || 'openai-chat-completions') !== (current.apiFormat || 'openai-chat-completions')) {
    for (const key of ['contextWindow', 'maxOutputTokens', 'maxInputTokens', 'maxModelOutputTokens', 'capabilitySource', 'capabilityCheckedAt', 'limitsMode'])
      if (!Object.hasOwn(changes, key)) delete merged[key];
    merged.contextWindow ||= 32768;
    merged.maxOutputTokens ||= 16384;
  }
  return applyCapabilities(merged);
}
module.exports = { capabilities, applyCapabilities, forModel };
