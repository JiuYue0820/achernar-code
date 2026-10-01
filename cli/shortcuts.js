'use strict';
const keys = {
  F2: 'cycle-approval',
  F3: 'fold-latest',
  F4: 'fold-all',
  F5: 'fold-plan',
  F6: 'f6',
  F7: 'f7',
  F8: 'f8',
  F9: 'f9',
  F10: 'f10',
  F11: 'f11',
  F12: 'f12',
  'Ctrl+O': 'toggle-details',
  'Ctrl+T': 'toggle-thinking',
  'Ctrl+P': 'palette',
  'Ctrl+U': 'undo-task',
  'Ctrl+R': 'redo-task',
  'Shift+Tab': 'cycle-mode',
};
const actions = [
  ['undo-task', 'Rewind last task', 'Ctrl+U'],
  ['redo-task', 'Restore undone task', 'Ctrl+R'],
  ['palette', 'Command palette', 'Ctrl+P'],
  ['cycle-approval', 'Cycle approval mode', 'F2'],
  ['cycle-mode', 'Cycle execution mode', 'Shift+Tab'],
  ['fold-latest', 'Toggle latest activity', 'F3'],
  ['fold-all', 'Toggle all activities', 'F4'],
  ['fold-plan', 'Toggle task plan', 'F5'],
  ['toggle-details', 'Toggle tool details', 'Ctrl+O'],
  ['toggle-thinking', 'Toggle thinking', 'Ctrl+T'],
];
const defaults = Object.fromEntries(actions.map(([action, , key]) => [action, key]));
function normalize(input = {}) {
  const result = { ...defaults };
  for (const [action, key] of Object.entries(input))
    if (Object.hasOwn(defaults, action) && (key === '' || Object.hasOwn(keys, key)))
      result[action] = key;
  const used = new Set();
  for (const action of Object.keys(result)) {
    if (result[action] && used.has(result[action])) result[action] = '';
    if (result[action]) used.add(result[action]);
  }
  return result;
}
function bind(input, action, key) {
  if (!Object.hasOwn(defaults, action) || (key && !Object.hasOwn(keys, key)))
    throw new Error('Unsupported shortcut.');
  const result = normalize(input);
  for (const other of Object.keys(result))
    if (other !== action && result[other] === key) result[other] = '';
  result[action] = key;
  return result;
}
function resolve(input, event) {
  const key = Object.entries(keys).find(([, value]) => value === event)?.[0];
  if (!key) return event;
  return Object.entries(normalize(input)).find(([, value]) => value === key)?.[0] || 'unbound';
}
function tips(input = {}, running = false) {
  const map = normalize(input);
  return [
    (map['undo-task'] || '/undo') + ' · Rewind last task',
    'Drag to select · Ctrl+C copy · Esc clear',
    'Click a message · Copy or rewind',
    '/shortcuts · View or change keys',
    (map['cycle-approval'] || '/approval') + ' · Change approval live',
    '/reasoning · Select reasoning strength',
    '/session · Del delete selected session',
    running ? 'Esc · Stop the running task' : '/model · Ctrl+E edit · Del delete',
  ];
}
async function configureShortcuts({ ui, settings, saveSettings }) {
  while (true) {
    const current = normalize(settings().shortcuts);
    const selected = await ui.choose('Keyboard shortcuts', [
      ...actions.map(([value, command]) => ({
        value,
        command,
        description: current[value] || 'Unbound',
      })),
      {
        value: '@fixed',
        command: 'Text and navigation',
        description: 'Selection, copy, input, model actions and menus',
      },
      {
        value: '@reset',
        command: 'Restore default shortcuts',
        description: 'Reset customized keys',
      },
    ]);
    if (!selected) return;
    if (selected === '@fixed') {
      const t = (text) => require('./i18n').translate(ui.state.language, text);
      await ui.view(
        t('Text and navigation'),
        t(
          'Enter · Send / choose\nAlt+Enter / Ctrl+J · New line\nCtrl+C · Copy selection; otherwise cancel task / exit\nEsc · Clear selection / close dialog / stop\nDrag · Select visible text (view freezes, task continues)\nShift+drag · Native terminal selection\nPgUp / PgDn · Scroll\nCtrl+E · Edit highlighted saved model\nDel · Delete highlighted saved model\nDel (/session) · Delete highlighted session (confirmation required)\nArrow keys · Navigate choices',
        ),
      );
      continue;
    }
    let next;
    if (selected === '@reset') next = { ...defaults };
    else {
      const key = await ui.choose('Assign shortcut', [
        ...Object.keys(keys).map((value) => ({
          value,
          command: value,
          description:
            actions.find(([a]) => a !== selected && current[a] === value)?.[1] || 'Available',
        })),
        { value: '@none', command: 'Unbind', description: 'Keep the command available' },
      ]);
      if (!key) continue;
      next = bind(current, selected, key === '@none' ? '' : key);
    }
    saveSettings({ shortcuts: next });
    ui.state.shortcuts = next;
    ui.toast('Shortcuts saved.');
  }
}
module.exports = { keys, actions, defaults, normalize, bind, resolve, tips, configureShortcuts };
