'use strict';
const fs = require('node:fs'),
  path = require('node:path');
const { validatePricing } = require('./model-runtime');
async function configureGovernance(
  command,
  value,
  {
    settings,
    saveSettings,
    library,
    ui,
    notice = (value) =>
      ui.notice(typeof value === 'string' ? value : JSON.stringify(value, null, 2)),
  },
) {
  const saved = settings();
  if (command === 'budget') {
    if (!value && ui)
      value = await ui.ask('Task budget in USD, or off (pricing is configured separately):');
    if (!value)
      return notice({
        maxCost: saved.maxCost ?? null,
        pricing: saved.pricing || null,
        maxOutputTokens: saved.maxOutputTokens || 4096,
      });
    if (value === 'off') {
      saveSettings({ maxCost: null });
      return notice('Cost cap disabled. Usage is still measured.');
    }
    const maxCost = Number(value);
    if (!Number.isFinite(maxCost) || maxCost <= 0)
      throw new Error('Enter a positive USD budget or off.');
    if (!validatePricing(saved.pricing))
      throw new Error('Configure input and output pricing before enabling a cost cap.');
    saveSettings({ maxCost });
    return notice('Task cost cap: $' + maxCost);
  }
  if (command === 'pricing') {
    if (!value && ui)
      value = await ui.ask('Input and output USD per million tokens, separated by a space:');
    if (!value) return notice(saved.pricing || { configured: false });
    const parts = value.split(/\s+/);
    if (parts.length !== 2)
      throw new Error('Use /pricing <input USD per million> <output USD per million>.');
    const pricing = validatePricing({ input: Number(parts[0]), output: Number(parts[1]) });
    saveSettings({ pricing });
    return notice({ pricing });
  }
  if (command === 'fallbacks') {
    if (value === 'clear') {
      saveSettings({ fallbacks: [] });
      return notice('Fallback chain cleared.');
    }
    const profiles = library?.profiles() || [];
    let selected = value.replace(/^add\s+/, '');
    if (!selected && ui)
      selected = await ui.choose('Fallback models', [
        ...profiles.map((profile, index) => ({
          value: String(index),
          command: profile.name || profile.modelId,
          description: profile.baseUrl,
        })),
        {
          value: '@clear',
          command: 'Clear fallback chain',
          description: 'Use only the primary model',
        },
      ]);
    if (selected === '@clear')
      return configureGovernance(command, 'clear', { settings, saveSettings, library, ui, notice });
    if (!selected || selected === 'list')
      return notice(
        (saved.fallbacks || []).map(({ name, modelId, baseUrl, pricing }) => ({
          name,
          modelId,
          baseUrl,
          pricing,
        })),
      );
    const profile =
      profiles.find((p) => p.name === selected || p.id === selected || p.modelId === selected) ||
      (/^\d+$/.test(selected) ? profiles[Number(selected)] : undefined);
    if (!profile)
      throw new Error('Select a configured model profile by name, model ID or list index.');
    const { apiKey: _apiKey, ...safe } = profile;
    const fallbacks = [
      ...(saved.fallbacks || []).filter(
        (p) => p.modelId !== safe.modelId || p.baseUrl !== safe.baseUrl,
      ),
      safe,
    ];
    if (fallbacks.length > 8) throw new Error('At most eight fallback models are supported.');
    saveSettings({ fallbacks });
    return notice('Fallback added: ' + profile.modelId);
  }
  if (command === 'hooks') {
    if (value === 'clear') {
      saveSettings({ hooks: {} });
      return notice('User hooks cleared.');
    }
    let file = value.replace(/^import\s+/, '');
    if (!file && ui)
      file = await ui.ask('Hooks JSON file to import (leave empty to show current hooks):');
    if (!file || file === 'show') return notice(saved.hooks || {});
    const absolute = path.resolve(file),
      stat = fs.statSync(absolute);
    if (stat.size > 100000) throw new Error('Hook configuration is too large.');
    const hooks = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    require('./tool-hooks').createToolHooks(hooks, {
      project: process.cwd(),
      signal: new AbortController().signal,
    });
    saveSettings({ hooks });
    return notice('User hooks imported. They execute with host permissions on subsequent tasks.');
  }
  if (command === 'language') {
    const { resolveLocale, locales } = require('./i18n');
    const names = {
      auto: 'Follow system',
      en: 'English',
      'zh-CN': '简体中文',
      ru: 'Русский',
      ja: '日本語',
      ko: '한국어',
      es: 'Español',
    };
    const locale =
      value ||
      (await ui?.choose(
        'Language',
        ['auto', 'zh-CN', 'en', 'ru', 'ja', 'ko', 'es'].map((value) => ({
          value,
          command: names[value],
          description: value,
        })),
      ));
    if (!locale) return notice(saved.language || 'auto');
    if (!['auto', ...locales].includes(locale))
      throw new Error('Language must be auto, en, zh-CN, ru, ja, ko or es.');
    saveSettings({ language: locale });
    if (ui?.setLanguage) ui.setLanguage(resolveLocale(locale));
    return notice('Language: ' + locale);
  }
  return false;
}
module.exports = { configureGovernance };
