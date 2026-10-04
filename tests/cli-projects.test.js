const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const records = require('../cli/session-records');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-projects-'));
  const home = path.join(root, 'home'), a = path.join(root, 'a'), b = path.join(a, 'nested');
  for (const dir of [home, a, b]) fs.mkdirSync(dir, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, home, a, b };
}
function save(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record));
}
test('folder sessions isolate nested projects and preserve matching legacy histories', t => {
  const { home, a, b } = fixture(t);
  const oldA = { id: randomUUID(), project: a, updatedAt: '2026-09-20' };
  const oldB = { id: randomUUID(), project: b, updatedAt: '2026-09-27' };
  save(records.sessionFile(home, oldA.id), oldA);
  save(records.sessionFile(home, oldB.id), oldB);
  assert.deepEqual(records.listSessionFiles(home, undefined, a).map(s => s.id), [oldA.id]);
  const next = { id: randomUUID(), project: a, updatedAt: '2026-09-28' };
  const file = records.sessionFile(home, next.id, a);
  assert.notEqual(file, records.sessionFile(home, next.id));
  save(file, next);
  assert.deepEqual(records.listSessionFiles(home, undefined, a).map(s => s.id), [next.id, oldA.id]);
  assert.throws(() => records.sessionFile(home, oldB.id, a), { code: 'SESSION_PROJECT_MISMATCH' });
  assert.throws(() => records.deleteSessionRecord(home, oldB.id, a), { code: 'SESSION_PROJECT_MISMATCH' });
  assert.ok(fs.existsSync(records.sessionFile(home, oldB.id)));
  records.deleteSessionRecord(home, oldA.id, a);
  assert.ok(fs.existsSync(file));
});
test('trust is explicit, persistent and exact-folder only; aliases share identity', async t => {
  const { root, home, a, b } = fixture(t);
  const { createProjectTrust, projectIdentity } = require('../cli/project-trust');
  const trust = createProjectTrust(home);
  await assert.rejects(trust.ensure(a), { code: 'PROJECT_NOT_TRUSTED' });
  await assert.rejects(trust.ensure(a, { confirm: async () => false }), { code: 'PROJECT_NOT_TRUSTED' });
  assert.equal(trust.isTrusted(a), false);
  let confirmations = 0;
  await trust.ensure(a, { confirm: async target => { assert.equal(target, fs.realpathSync.native(a)); confirmations++; return true; } });
  await createProjectTrust(home).ensure(a, { confirm: () => assert.fail('already trusted') });
  assert.equal(confirmations, 1);
  assert.equal(trust.isTrusted(b), false);
  const alias = path.join(root, 'alias');
  fs.symlinkSync(a, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(projectIdentity(alias).key, projectIdentity(a).key);
  assert.equal(trust.isTrusted(alias), true);
  trust.revoke(a);
  assert.equal(trust.isTrusted(alias), false);
});
test('untrusted CLI refuses project reads and task input before model setup; help remains usable', t => {
  const { home, a } = fixture(t);
  const call = args => spawnSync(process.execPath, [path.resolve(__dirname, '../cli/index.js'), '-C', a, '--json', ...args], {
    env: { ...process.env, ACHERNAR_CLI_HOME: home, ACHERNAR_NOTIFICATIONS: '0' }, encoding: 'utf8', windowsHide: true,
  });
  for (const args of [['inspect'], ['sessions'], ['run', '--approval', 'auto', '--task-file', 'does-not-exist.txt']]) {
    const result = call(args);
    assert.notEqual(result.status, 0, result.stdout);
    assert.equal(JSON.parse(result.stdout).error.code, 'PROJECT_NOT_TRUSTED');
  }
  assert.equal(call(['--help']).status, 0);
  assert.equal(call(['--trust-project', 'sessions']).status, 0);
  assert.equal(call(['sessions']).status, 0);
});
test('/cd refusal keeps the current conversation and cannot resume a foreign project', async t => {
  const { a, b } = fixture(t), { createChatCommands } = require('../cli/chat-commands');
  let project = a;
  const current = { id: 'active', project: a, messages: [] };
  const ui = { state: { logs: [] }, metrics: {}, context() {}, reset() { assert.fail('must not reset on refused switch'); }, notice() {} };
  const commands = createChatCommands({
    ui, options: {}, cwd: () => project, settings: () => ({}), saveSettings() {},
    setWorkspace: value => { project = value; },
    ensureProject: async () => { throw Object.assign(new Error('Not trusted'), { code: 'PROJECT_NOT_TRUSTED' }); },
    loadSession: () => ({ id: 'foreign', project: b, messages: [] }),
  });
  commands.setSession(current);
  await assert.rejects(commands.handle('/cd ' + b), { code: 'PROJECT_NOT_TRUSTED' });
  assert.equal(project, a);
  assert.equal(commands.getSession(), current);
  await assert.rejects(commands.handle('/resume foreign'), /another project/);
});
test('trust dialog keeps the directory and default-cancel choice visible in small terminals', async () => {
  const { EventEmitter } = require('node:events'), { TerminalUI } = require('../cli/tui');
  const { renderScreen } = require('../cli/tui-screen');
  const input = Object.assign(new EventEmitter(), { setRawMode() {}, pause() {} });
  const output = Object.assign(new EventEmitter(), { columns: 80, rows: 26, write() {} });
  const ui = new TerminalUI({ input, output, project: 'C:\\Projects\\App', animate: false, language: 'zh-CN' });
  const pending = ui.choose('Trust this project?', [
    { value: 'cancel', command: 'Cancel', description: 'Leave this folder unopened' },
    { value: 'trust', command: 'Trust project', description: 'Allow project access and remember this folder' },
  ], undefined, { context: ['C:\\Projects\\App', 'History is private to this exact folder.'] });
  for (const [width, height] of [[100, 32], [55, 24], [40, 20]]) {
    const frame = renderScreen(ui.state, width, height), text = frame.canvas.lines(false).join('\n');
    assert.match(text, /信任此项目/);
    assert.match(text, /C:\\Projects\\App/);
    assert.ok(frame.hitboxes.every(box => box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height));
  }
  ui.key('enter');
  assert.equal(await pending, 'cancel');
  ui.close();
});
