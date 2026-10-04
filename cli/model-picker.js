'use strict';
const choices = (values) =>
  values.map(([value, description]) => ({ command: value, value, description }));
const translator = (ui, settings) => (text) =>
  require('./i18n').translate(
    ui.state?.language || require('./i18n').resolveLocale(settings().language),
    text,
  );
async function selectModel(
  value,
  {
    settings,
    library,
    ui,
    discoverModels,
    setModel,
    saveSettings,
    saveCredential,
    refresh,
    integrations,
    handle,
  },
) {
  if (value) setModel(value);
  else {
    const s = settings(), t = translator(ui, settings);
    let models = [],
      metadata = {},
      expanded = false,
      discovered = false,
      selected;
    const profiles = library?.profiles() || [];
    const sameProvider = (p) =>
      p.baseUrl?.replace(/\/+$/, '') === s.baseUrl?.replace(/\/+$/, '') &&
      p.apiFormat === s.apiFormat;
    const isCurrent = (p) => sameProvider(p) && p.modelId === s.modelId;
    const configured = new Set([s.modelId, ...profiles.filter(sameProvider).map((p) => p.modelId)]);
    const canDiscover = Boolean(
      s.apiKey || /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/i.test(s.baseUrl),
    );
    while (true) {
      const extra = [...new Set(models)]
        .filter((id) => typeof id === 'string' && id && !configured.has(id))
        .slice(0, 500);
      selected = await ui.choose(
        t('Select model'),
        [
          ...profiles.map((p, i) => ({
            value: '@profile:' + i,
            command: p.name || p.modelId,
            description: isCurrent(p) ? t('Current model') : t('Configured') + ' · ' + p.apiFormat,
            editable: true,
          })),
          ...(s.modelId && !profiles.some(isCurrent)
            ? [
                {
                  value: s.modelId,
                  command: s.modelId,
                  description: t('Current model'),
                  editable: true,
                },
              ]
            : []),
          ...(canDiscover
            ? [
                {
                  value: '@toggle-provider',
                  command: (expanded ? '▾ ' + t('Hide') : '▸ ' + t('Show')) + ' ' + t('provider models'),
                  description: discovered
                    ? `${extra.length} ${t('other models')} · ${s.providerName || t('Current provider')}`
                    : t('Discover other models only when expanded'),
                },
              ]
            : []),
          ...(expanded ? choices(extra.map((id) => [id, t('Available from provider')])) : []),
          ...(library
            ? [
                {
                  value: '@add',
                  command: t('+ Create model'),
                  description: t('Provider, Base URL and API Key'),
                },
              ]
            : []),
          {
            value: '@manual',
            command: t('+ Model ID'),
            description: t('Use the current provider settings'),
          },
          {
            value: '@reasoning',
            command: t('Reasoning strength'),
            description: require('../src/reasoning').label(s) + ' · ' + t('select or customize'),
          },
          ...(library
            ? [
                {
                  value: '@import',
                  command: t('+ Import models'),
                  description: t('Load profiles from JSON'),
                },
              ]
            : []),
        ],
        undefined,
        {
          roomy: true,
          actions: [
            { key: 'edit-model', label: 'Ctrl+E ' + t('Edit'), action: 'edit' },
            { key: 'delete', label: 'Del ' + t('Delete'), action: 'delete' },
          ],
        },
      );
      if (selected !== '@toggle-provider') break;
      expanded = !expanded;
      if (expanded && !discovered) {
        const previousStatus = ui.state.status;
        ui.state.status = t('Loading models');
        ui.draw();
        try {
          const result = await discoverModels();
          models = Array.isArray(result.models) ? result.models : [];
          metadata = result.metadata || {};
          discovered = true;
        } catch (error) {
          expanded = false;
          ui.notice(
            t('Model discovery failed.') + ' ' +
              t('Enter an ID manually or check /provider and /format.') + ' ' +
              error.message,
            'error',
          );
        } finally {
          ui.state.status = previousStatus;
        }
      }
    }
    if (selected?.action) {
      let profile = selected.value?.startsWith('@profile:')
        ? profiles[Number(selected.value.slice(9))]
        : selected.value === s.modelId
          ? {
              name: s.name || s.modelId,
              modelId: s.modelId,
              baseUrl: s.baseUrl,
              apiFormat: s.apiFormat,
              contextWindow: s.contextWindow,
              credentialId: s.credentialId,
              keyEnv: s.keyEnv,
              ...require('../src/reasoning').normalize(s),
            }
          : null;
      if (profile && library) {
        if (!profiles.some((p) => isCurrent(p)) && selected.value === s.modelId)
          library.saveProfile(profile);
        await require('./model-actions').modelAction(selected.action, profile, {
          ui,
          library,
          settings,
          saveSettings,
          saveCredential,
          refresh,
        });
      }
    } else if (selected === '@reasoning') await handle('/reasoning');
    else if (selected === '@manual') {
      const id = await ui.ask(t('Model ID (Esc to cancel):'));
      if (id.trim()) setModel(id.trim());
    } else if (['@edit', '@import', '@add'].includes(selected))
      await integrations.handle('/model ' + selected.slice(1));
    else if (selected?.startsWith('@profile:')) {
      const profile = profiles[Number(selected.slice(9))];
      if (profile) {
        saveSettings(profile);
        refresh();
        ui.notice(t('Selected profile: ') + profile.name);
      }
    } else if (selected) {
      setModel(selected);
      const info = metadata[selected];
      if (info) {
        saveSettings({
          ...(info.contextWindow
            ? { contextWindow: Math.min(2000000, Math.max(1024, info.contextWindow)) }
            : {}),
          ...(info.reasoningDetected
            ? { reasoningDetected: true, reasoningLevels: info.reasoningLevels }
            : {}),
        });
        refresh();
      }
    }
  }
}
module.exports = { selectModel };
