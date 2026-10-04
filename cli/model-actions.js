'use strict';
const reasoning = require('../src/reasoning');
const same = (a, b) =>
  a.modelId === b.modelId &&
  a.baseUrl?.replace(/\/+$/, '') === b.baseUrl?.replace(/\/+$/, '') &&
  (a.apiFormat || 'openai-chat-completions') === (b.apiFormat || 'openai-chat-completions');
async function modelAction(
  action,
  profile,
  { ui, library, settings, saveSettings, saveCredential, refresh },
) {
  if (!profile) return;
  if (action === 'delete') {
    const confirm = await ui.choose('Delete saved model?', [
      { value: 'keep', command: 'Keep model', description: profile.name || profile.modelId },
      {
        value: 'delete',
        command: 'Delete model',
        description: 'Remove this profile; keep conversation history',
        danger: true,
      },
    ]);
    if (confirm !== 'delete') return;
    library.removeProfile(profile);
    const current = settings(),
      changes = { fallbacks: (current.fallbacks || []).filter((p) => !same(p, profile)) };
    if (same(current, profile))
      Object.assign(changes, {
        modelId: '',
        credentialId: null,
        pricing: null,
        ...reasoning.forModel(current, { modelId: '' }),
      });
    saveSettings(changes);
    refresh();
    ui.notice('Model deleted: ' + profile.modelId);
    return;
  }
  const kind = await ui.choose('Edit model · ' + profile.modelId, [
    {
      value: 'connection',
      command: 'Provider and model',
      description: 'Endpoint, API key, ID, format and context limit',
    },
    {
      value: 'reasoning',
      command: 'Reasoning strength',
      description: reasoning.label(profile) + ' · select or customize',
    },
  ]);
  if (!kind) return;
  const persist = (next) => {
    library.replaceProfile(profile, next);
    if (same(settings(), profile)) saveSettings(next);
    refresh();
  };
  if (kind === 'reasoning') {
    let draft = { ...profile };
    const result = await require('./reasoning-menu').configureReasoning('', {
      ui,
      settings: () => draft,
      saveSettings: (changes) => {
        draft = { ...draft, ...changes };
      },
    });
    if (result) persist(draft);
  } else {
    const draft = await require('./model-wizard').modelWizard(ui, profile, true);
    if (!draft) return;
    const { apiKey, ...safe } = draft;
    if (apiKey) {
      if (!saveCredential) throw new Error('Encrypted credential storage is unavailable.');
      safe.credentialId = saveCredential(safe.baseUrl, safe.apiFormat, apiKey);
    }
    const identityChanged = !same(profile, safe);
    const next = {
      ...profile,
      ...safe,
      ...reasoning.forModel(profile, safe),
      ...(identityChanged ? { pricing: null } : {}),
    };
    persist(next);
    ui.notice('Saved model: ' + next.modelId);
  }
}
module.exports = { modelAction };
