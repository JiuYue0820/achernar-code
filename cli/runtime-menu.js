'use strict';
const { fields, normalize } = require('../src/runtime-settings');
async function configureRuntime(value, { ui, settings, saveSettings }) {
  const current = normalize(settings().runtime);
  if (value) {
    const [key, ...raw] = value.split(/\s+/);
    if (!fields[key]) throw new Error('Unknown setting; use /settings to choose a setting.');
    const text = raw.join(' '),
      parsed =
        typeof fields[key].default === 'boolean'
          ? text === 'true'
            ? true
            : text === 'false'
              ? false
              : text
          : Number(text);
    const next = normalize({ ...current, [key]: parsed });
    saveSettings({ runtime: next });
    ui.notice(`${fields[key].labelEn}: ${next[key]}`);
    return;
  }
  const key = await ui.choose(
    'Runtime settings',
    Object.entries(fields).map(([key, field]) => ({
      value: key,
      command: field.labelEn,
      description: String(current[key]) + (field.unit ? ' ' + (field.unitEn || field.unit) : ''),
    })),
  );
  if (!key) return;
  const field = fields[key];
  let selected;
  if (typeof field.default === 'boolean')
    selected = await ui.choose(field.labelEn, [
      { value: 'true', command: 'Enabled', description: '' },
      { value: 'false', command: 'Disabled', description: '' },
    ]);
  else
    selected = await ui.ask(
      `${field.labelEn}: ${current[key]}. Enter ${field.min}–${field.max} ${field.unit || ''}:`,
    );
  if (selected) await configureRuntime(`${key} ${selected}`, { ui, settings, saveSettings });
}
module.exports = { configureRuntime };
