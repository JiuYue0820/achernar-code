'use strict';
const { capabilities, applyCapabilities } = require('../src/model-capabilities');
const presets = [
  ['OpenAI', 'https://api.openai.com/v1', 'openai-chat-completions'],
  ['Anthropic', 'https://api.anthropic.com/v1', 'anthropic-messages'],
  ['Google', 'https://generativelanguage.googleapis.com/v1beta', 'gemini'],
  ['DeepSeek', 'https://api.deepseek.com/v1', 'openai-chat-completions'],
  ['OpenRouter', 'https://openrouter.ai/api/v1', 'openai-chat-completions'],
  ['Ollama', 'http://localhost:11434/v1', 'openai-chat-completions'],
  ['Custom', '', 'openai-chat-completions'],
];
async function modelWizard(ui, current = {}, edit = false) {
  const t = (text) => require('./i18n').translate(ui.state?.language, text);
  const draft = {
    providerName: edit ? current.providerName || current.name || 'Custom' : '',
    baseUrl: edit ? current.baseUrl || '' : '',
    apiFormat: edit ? current.apiFormat || 'openai-chat-completions' : 'openai-chat-completions',
    modelId: edit ? current.modelId || '' : '',
    contextWindow: edit ? current.contextWindow || 32768 : 32768,
    maxOutputTokens: edit ? current.maxOutputTokens || 16384 : 16384,
    apiKey: '',
    credentialId: edit ? current.credentialId : null,
  };
  let step = 0;
  const fields = [
    null,
    ['baseUrl', 'Base URL'],
    ['apiKey', 'API Key'],
    ['modelId', 'Model ID'],
    null,
    ['contextWindow', 'Context limit'],
    ['maxOutputTokens', 'Output limit'],
  ];
  while (step >= 0 && step < 7) {
    if (step === 5 && capabilities(draft)) {
      Object.assign(draft, applyCapabilities(draft), { limitsMode: 'auto' });
      ui.notice?.(
        t('Model limits configured automatically') + ' · ' + t('Context') + ' ' + draft.contextWindow.toLocaleString() + ' · ' + t('Output') + ' ' + draft.maxOutputTokens.toLocaleString(),
      );
      break;
    }
    if (step === 0) {
      const name = await ui.choose(
        t(edit ? 'Edit model' : 'Create model') + ' · ' + t('Provider'),
        presets.map(([name, url]) => ({
          command: name,
          value: name,
          description: url || t('Your own provider or local server'),
        })),
      );
      if (!name) return null;
      const preset = presets.find((p) => p[0] === name);
      if (draft.providerName !== name) {
        draft.providerName = name;
        draft.baseUrl = preset[1];
        draft.apiFormat = preset[2];
        draft.credentialId = null;
        draft.apiKey = '';
      }
      step++;
      continue;
    }
    if (step === 4) {
      const format = await ui.choose(
        t(edit ? 'Edit model' : 'Create model') + ' · ' + t('API format') + ' · ' + t('Esc back'),
        require('../src/provider-formats').map((f) => ({
          command: f.name,
          value: f.id,
          description: f.id,
        })),
      );
      if (!format) {
        step--;
        continue;
      }
      draft.apiFormat = format;
      step++;
      continue;
    }
    const [key, label] = fields[step];
    const result = await ui.field({
      title: t(edit ? 'Edit model' : 'Create model') + ' · ' + t(label),
      description:
        key === 'apiKey'
          ? t('Masked input. Enter keeps an existing key; leave empty for local/no-auth services. Saved with Windows encryption.')
          : key === 'contextWindow'
            ? t('Model context capacity in tokens (1024–2000000).')
            : key === 'maxOutputTokens'
              ? t('Maximum output tokens including thinking; must fit inside the context limit.')
              : t('Enter to continue. Esc returns to the previous step and keeps your input.'),
      initial: String(draft[key]),
      secret: key === 'apiKey',
      allowEmpty: key === 'apiKey',
    });
    if (!result || result.action === 'cancel') return null;
    draft[key] = result.value;
    if (result.action === 'back') {
      step--;
      continue;
    }
    try {
      if (key === 'baseUrl') {
        const url = new URL(draft.baseUrl);
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new Error('Use an HTTP(S) base URL without credentials or query parameters.');
        draft.baseUrl = draft.baseUrl.replace(/\/+$/, '');
      }
      if (key === 'modelId' && (!draft.modelId.trim() || /\s/.test(draft.modelId)))
        throw new Error('Enter a model ID without whitespace.');
      if (key === 'contextWindow') {
        draft.contextWindow = Number(draft.contextWindow);
        if (
          !Number.isInteger(draft.contextWindow) ||
          draft.contextWindow < 1024 ||
          draft.contextWindow > 2000000
        )
          throw new Error('Context limit must be 1024–2000000.');
      }
      if (key === 'maxOutputTokens') {
        draft.maxOutputTokens = Number(draft.maxOutputTokens);
        if (
          !Number.isInteger(draft.maxOutputTokens) ||
          draft.maxOutputTokens < 1 ||
          draft.maxOutputTokens >= draft.contextWindow
        )
          throw new Error('Output limit must be positive and smaller than the context limit.');
        draft.limitsMode = 'custom';
      }
      step++;
    } catch (error) {
      ui.toast(error.message);
    }
  }
  if (draft.baseUrl !== current.baseUrl || draft.apiFormat !== current.apiFormat)
    draft.credentialId = null;
  return {
    ...draft,
    ...require('../src/reasoning').forModel(edit ? current : {}, draft),
    name: draft.providerName + ' · ' + draft.modelId,
  };
}
module.exports = { modelWizard };
