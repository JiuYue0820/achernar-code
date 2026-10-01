'use strict';
const reasoning = require('../src/reasoning');
function validateOptions(input) {
  if (!Array.isArray(input) || !input.length || input.length > 32)
    throw new Error('Provide 1–32 reasoning levels with a label and API value.');
  const result = reasoning.options(input);
  if (
    result.length !== input.length ||
    input.some(
      (item) =>
        typeof item !== 'string' &&
        (!item || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 80),
    )
  )
    throw new Error(
      'Reasoning levels need unique API values and nonempty labels, up to 80 characters each.',
    );
  if (result.some((item) => /^default$/i.test(item.value)))
    throw new Error('"default" is reserved for the provider default.');
  return result;
}
function readOptions(filename) {
  const fs = require('node:fs');
  if (fs.statSync(filename).size > 65536) throw new Error('Reasoning options file exceeds 64 KiB.');
  return validateOptions(JSON.parse(fs.readFileSync(filename, 'utf8')));
}
function saveReasoning(change, { settings, saveSettings, library }) {
  const current = settings(),
    next = { ...current, ...change },
    normalized = reasoning.normalize(next);
  const prior = library
    ?.profiles()
    .find(
      (p) =>
        p.modelId === current.modelId &&
        p.baseUrl?.replace(/\/+$/, '') === current.baseUrl?.replace(/\/+$/, '') &&
        (p.apiFormat || 'openai-chat-completions') ===
          (current.apiFormat || 'openai-chat-completions'),
    );
  saveSettings(normalized);
  if (current.modelId)
    library?.saveProfile({
      ...prior,
      name: prior?.name || current.modelId,
      modelId: current.modelId,
      baseUrl: current.baseUrl,
      apiFormat: current.apiFormat || 'openai-chat-completions',
      contextWindow: current.contextWindow,
      maxOutputTokens: current.maxOutputTokens,
      limitsMode: current.limitsMode,
      ...(current.credentialId ? { credentialId: current.credentialId } : {}),
      ...(current.keyEnv ? { keyEnv: current.keyEnv } : {}),
      ...(current.pricing ? { pricing: current.pricing } : {}),
      ...normalized,
    });
  return normalized;
}
async function editLevels(input, ui) {
  let draft = reasoning.supported(input);
  while (true) {
    const selected = await ui.choose('Custom reasoning levels · label → API value', [
      ...draft.map((item, i) => ({
        value: '@item:' + i,
        command: item.label,
        description: item.value,
      })),
      ...(draft.length < 32
        ? [
            {
              value: '@add',
              command: 'Add level',
              description: 'Display name and exact provider API value',
            },
          ]
        : []),
      {
        value: '@apply',
        command: 'Save levels',
        description: 'Unsupported API values will be rejected by the provider',
      },
    ]);
    if (!selected) return null;
    if (selected === '@apply') return validateOptions(draft);
    const index = selected === '@add' ? draft.length : Number(selected.slice(6));
    const item = draft[index];
    if (item) {
      const action = await ui.choose(item.label, [
        { value: 'edit', command: 'Edit level', description: item.value },
        {
          value: 'delete',
          command: 'Remove level',
          description: 'Remove from this model only',
          danger: true,
        },
      ]);
      if (!action) continue;
      if (action === 'delete') {
        draft = draft.filter((_, i) => i !== index);
        continue;
      }
    }
    const label = await ui.ask(`Display name${item ? ' (currently ' + item.label + ')' : ''}:`);
    if (!label.trim()) continue;
    const value = await ui.ask(`API value${item ? ' (currently ' + item.value + ')' : ''}:`);
    if (!value.trim()) continue;
    const next = [...draft];
    next[index] = { label: label.trim(), value: value.trim() };
    try {
      draft = validateOptions(next);
    } catch (error) {
      ui.notice(error.message, 'error');
    }
  }
}
async function configureReasoning(value, context, options = {}) {
  const { ui, settings } = context;
  let draft = require('../src/model-capabilities').applyCapabilities(settings()),
    change = false;
  if (options.mode) {
    if (!['auto', 'custom', 'off'].includes(options.mode))
      throw new Error('Reasoning mode must be auto, custom or off.');
    draft.reasoningMode = options.mode;
    draft.reasoningLevel = '';
    change = true;
  }
  if (options.optionsFile) {
    draft.reasoningOptions = readOptions(options.optionsFile);
    draft.reasoningMode = 'custom';
    change = true;
  }
  if (value) {
    draft = { ...draft, ...reasoning.select(draft, value) };
    change = true;
  } else if (ui && !change) {
    const selected = await ui.choose('Reasoning strength · ' + (draft.modelId || 'current model'), [
      {
        value: '@default',
        command: 'Provider default',
        description: 'Omit reasoning parameter; this does not disable thinking',
      },
      ...reasoning.supported(draft).map((item) => ({
        value: item.value,
        command: item.label,
        description:
          (draft.reasoningLevel === item.value ? 'Selected · ' : '') + 'API: ' + item.value,
      })),
      {
        value: '@configure',
        command: 'Configure levels',
        description: 'Automatic, custom labels / API values, or unsupported',
      },
    ]);
    if (!selected) return null;
    if (selected === '@configure') {
      const mode = await ui.choose('Reasoning configuration', [
        {
          value: 'auto',
          command: 'Automatic',
          description: 'Use advertised capabilities or provider defaults',
        },
        {
          value: 'custom',
          command: 'Custom levels',
          description: 'Define your own labels and API values',
        },
        {
          value: 'off',
          command: 'Unsupported',
          description: 'Never send a reasoning parameter; does not disable provider thinking',
        },
      ]);
      if (!mode) return null;
      if (mode === 'custom') {
        const levels = await editLevels(draft, ui);
        if (!levels) return null;
        draft.reasoningOptions = levels;
      }
      draft.reasoningMode = mode;
      draft.reasoningLevel = '';
      change = true;
    } else {
      draft = {
        ...draft,
        ...reasoning.select(draft, selected === '@default' ? 'default' : selected),
      };
      change = true;
    }
  }
  const result = change ? saveReasoning(draft, context) : reasoning.normalize(draft);
  if (change && ui)
    ui.notice(
      'Reasoning: ' + reasoning.label({ ...draft, ...result }) + '. Applies to the next task.',
    );
  return result;
}
module.exports = { configureReasoning, validateOptions, readOptions, saveReasoning };
