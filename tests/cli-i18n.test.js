const test = require('node:test'), assert = require('node:assert/strict');
const api = (() => { try { return require('../cli/i18n'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; return {}; } })();
test('UI locale follows system environment with an explicit override and English fallback', () => {
  assert.equal(typeof api.resolveLocale, 'function');
  assert.equal(api.resolveLocale('auto', { LANG: 'zh_CN.UTF-8' }), 'zh-CN');
  assert.equal(api.resolveLocale('auto', { LC_ALL: 'ja_JP.UTF-8' }), 'ja');
  assert.equal(api.resolveLocale('en', { LANG: 'zh_CN.UTF-8' }), 'en');
  assert.equal(api.resolveLocale('auto', { LANG: 'de_DE.UTF-8' }), 'en');
  for (const locale of ['zh-CN', 'ja', 'ko', 'es']) assert.notEqual(api.translate(locale, 'Select model'), 'Select model');
});
test('localized TUI keeps user/model code unchanged and translates controls and placeholders', () => {
  const { TerminalUI } = require('../cli/tui'), { renderScreen } = require('../cli/tui-screen');
  const ui = new TerminalUI({ project: '.', version: 'test', language: 'zh-CN' });
  const initial = renderScreen(ui.state, 120, 34).canvas.lines(false).join('\n');
  assert.match(initial, /描述任务/); assert.match(initial, /编程/);
  ui.notice('const Thinking = "Select model";', 'assistant');
  const conversation = renderScreen(ui.state, 120, 34).canvas.lines(false).join('\n');
  assert.match(conversation, /const Thinking = "Select model";/);
  ui.setLanguage('es'); assert.equal(ui.state.language, 'es');
  ui.event({ type: 'cost', costUsd: .4 }); ui.reset(); assert.equal(ui.state.cost, null);
});
test('system notifications use the selected UI language without exposing task content', async () => {
  const { createTaskNotifications } = require('../src/services/task-notifications');
  for (const [language, word] of [['zh-CN', '任务'], ['en', 'Task'], ['ja', 'タスク'], ['ko', '작업'], ['es', 'Tarea']]) {
    const received = [];
    const notifications = createTaskNotifications({ enabled: true, send: async value => received.push(value) }).start({ language, source: 'cli' });
    await notifications.complete(); assert.ok(received[0].title.includes(word), language);
  }
});
test('all command descriptions and update controls are translated in the four requested languages', () => {
  const { commandCatalog } = require('../cli/tui');
  for (const locale of ['zh-CN', 'ru', 'ja']) {
    for (const item of commandCatalog()) assert.notEqual(api.translate(locale, item.description), item.description, locale + ': ' + item.description);
    for (const label of ['CLI updates', 'Install CLI update?', 'Update notifications', 'Reasoning strength', 'Copy message']) {
      assert.notEqual(api.translate(locale, label), label, locale + ': ' + label);
    }
  }
  assert.equal(api.translate('en', 'CLI updates'), 'CLI updates');
});
