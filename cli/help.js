'use strict';
function helpText(language, catalog, shortcuts) {
  const t = (text) => require('./i18n').translate(language, text),
    bindings = require('./shortcuts');
  const config = bindings.normalize(shortcuts);
  return [
    'Achernar',
    ...catalog.map((entry) => entry.command.padEnd(17) + t(entry.description)),
    '',
    t('Keyboard shortcuts'),
    ...bindings.actions.map(([action, label]) => (config[action] || '—').padEnd(17) + t(label)),
    '',
    t('Enter send · Alt+Enter newline · / commands · PgUp/PgDn scroll'),
    t('Drag to select · Ctrl+C copy · Esc clear'),
    t(
      'Model and reasoning changes apply to the next task. Approvals and language apply immediately.',
    ),
    t(
      'Checkpoints restore files and conversation. External changes are never silently overwritten.',
    ),
    t('Data from models, tools, paths and source files keeps its original language.'),
  ].join('\n');
}
module.exports = { helpText };
