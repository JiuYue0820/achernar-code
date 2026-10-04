'use strict';
const reasoning = require('../src/reasoning');
/** Persist non-secret model state and bind encrypted credentials to its endpoint. */
function saveSettings(changes, { settings, config, configPath, write, program, credentials }) {
  const { apiKey, ...safe } = changes,
    current = settings();
  const modelChanged = ['modelId', 'baseUrl', 'apiFormat'].some(
    (key) => safe[key] != null && safe[key] !== current[key],
  );
  const legacyKnownProfile =
    safe.modelId &&
    !safe.limitsMode &&
    require('../src/model-capabilities').capabilities({ ...current, ...safe });
  if (modelChanged || safe.limitsMode === 'auto' || legacyKnownProfile) {
    const merged = require('../src/model-capabilities').forModel(current, {
      ...safe,
      limitsMode: safe.limitsMode || 'auto',
    });
    for (const key of [
      'contextWindow',
      'maxInputTokens',
      'maxOutputTokens',
      'maxModelOutputTokens',
      'capabilitySource',
      'reasoningLevels',
      'reasoningDetected',
      'limitsMode',
    ])
      if (merged[key] != null) safe[key] = merged[key];
  } else if (Object.hasOwn(safe, 'contextWindow') || Object.hasOwn(safe, 'maxOutputTokens')) {
    safe.limitsMode = 'custom';
  }
  if (
    Object.keys(safe).some(
      (key) => key.startsWith('reasoning') || ['modelId', 'baseUrl', 'apiFormat'].includes(key),
    )
  ) {
    Object.assign(safe, reasoning.forModel(current, safe));
    program.setOptionValue('reasoning', undefined);
  }
  if (
    !Object.hasOwn(safe, 'pricing') &&
    ((safe.modelId && safe.modelId !== current.modelId) ||
      (safe.baseUrl && safe.baseUrl !== current.baseUrl) ||
      (safe.apiFormat && safe.apiFormat !== current.apiFormat))
  )
    safe.pricing = null;
  if (apiKey)
    safe.credentialId = credentials.set(
      safe.baseUrl || current.baseUrl,
      safe.apiFormat || current.apiFormat,
      apiKey,
    );
  else if (
    !Object.hasOwn(safe, 'credentialId') &&
    ((safe.baseUrl && safe.baseUrl !== current.baseUrl) ||
      (safe.apiFormat && safe.apiFormat !== current.apiFormat))
  )
    safe.credentialId = null;
  write(configPath, { ...config(), ...safe });
  for (const [key, option] of [
    ['language', 'language'],
    ['modelId', 'model'],
    ['baseUrl', 'baseUrl'],
    ['apiFormat', 'format'],
    ['shell', 'shell'],
    ['sandbox', 'sandbox'],
    ['sandboxImage', 'sandboxImage'],
    ['maxOutputTokens', 'maxOutputTokens'],
    ['jobMemoryMb', 'jobMemoryMb'],
    ['jobProcesses', 'jobProcesses'],
    ['writePaths', 'writeDir'],
  ])
    if (Object.hasOwn(safe, key)) program.setOptionValue(option, safe[key]);
}
module.exports = { saveSettings };
