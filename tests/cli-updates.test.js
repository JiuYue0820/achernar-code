const test = require('node:test'), assert = require('node:assert/strict');
const updates = require('../cli/updates');
const fetcher = version => async url => { assert.equal(url, 'https://registry.npmjs.org/achernar-code'); return new Response(JSON.stringify({ 'dist-tags': { latest: version, next: version }, versions: { [version]: { name: 'achernar-code', version } } }), { status: 200 }); };
test('update checks compare stable and preview versions without accepting arbitrary install targets', async () => {
  assert.equal(updates.compareVersions('0.2.0', '0.2.0-rc.10'), 1);
  assert.equal(updates.compareVersions('0.2.0-rc.10', '0.2.0-rc.4'), 1);
  assert.equal((await updates.checkUpdate({ currentVersion: '0.1.0', fetcher: fetcher('0.2.0') })).status, 'available');
  assert.equal((await updates.checkUpdate({ currentVersion: '0.2.1', fetcher: fetcher('0.2.0') })).status, 'up_to_date');
  assert.equal((await updates.checkUpdate({ currentVersion: '0.2.0', fetcher: async () => new Response('', { status: 404 }) })).status, 'unpublished');
  assert.throws(() => updates.installUpdate({ status: 'available', package: 'other', version: '1.0.0' }), /official/);
  assert.throws(() => updates.installUpdate({ status: 'available', package: 'achernar-code', version: '1.0.0 & bad' }), /official/);
});
test('update install command is pinned to a verified version and never uses arbitrary shell fragments', async () => {
  const { EventEmitter } = require('node:events'); let args;
  const result = await updates.installUpdate({ status: 'available', package: 'achernar-code', version: '0.2.0' }, { run(command, argv) {
    args = [command, ...argv]; const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); setImmediate(() => child.emit('close', 0)); return child;
  } });
  assert.ok(args.join(' ').includes('achernar-code@0.2.0')); assert.ok(args.join(' ').includes('--ignore-scripts')); assert.equal(result.restartRequired, true);
});
test('update menu never installs while a task runs or when confirmation is declined', async () => {
  let installed = 0, pick = 'later';
  const context = { manifest: { name: 'achernar-code', version: '0.1.0' }, settings: () => ({}), saveSettings() {}, isRunning: () => true,
    ui: { choose: async () => pick, notice() {} }, check: async () => ({ status: 'available', version: '0.2.0' }), install: async () => installed++ };
  const { configureUpdates } = require('../cli/update-menu');
  await configureUpdates('check', context); assert.equal(installed, 0);
  pick = 'install'; await assert.rejects(configureUpdates('check', context), /Stop/); assert.equal(installed, 0);
});
test('preview users graduate to stable even when the next tag still points at an older candidate', async () => {
  const data = { 'dist-tags': { latest: '0.2.0', next: '0.2.0-rc.4' }, versions: {
    '0.2.0': { name: 'achernar-code', version: '0.2.0' },
    '0.2.0-rc.4': { name: 'achernar-code', version: '0.2.0-rc.4' },
  } };
  const result = await updates.checkUpdate({ currentVersion: '0.2.0-rc.5', channel: 'next', fetcher: async () => new Response(JSON.stringify(data)) });
  assert.equal(result.status, 'available');
  assert.equal(result.version, '0.2.0');
});
test('stable checks never offer a prerelease accidentally tagged latest', async () => {
  await assert.rejects(updates.checkUpdate({ currentVersion: '0.1.0', fetcher: fetcher('0.2.0-rc.6') }), /stable/i);
});
test('background update checks reuse the daily cache, invalidate across versions, and ignore offline errors', async t => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'achernar-updates-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  let calls = 0; const notices = [];
  const options = { home, manifest: { name: 'achernar-code', version: '0.1.0' }, notify: release => notices.push(release.version),
    fetcher: async url => { calls++; return fetcher('0.2.0')(url); } };
  await updates.backgroundCheck(options); await updates.backgroundCheck(options);
  assert.equal(calls, 1); assert.deepEqual(notices, ['0.2.0', '0.2.0']);
  await updates.backgroundCheck({ ...options, manifest: { name: 'achernar-code', version: '0.2.0' } });
  assert.equal(calls, 2); assert.equal(notices.length, 2);
  await updates.backgroundCheck({ ...options, manifest: { name: 'achernar', version: '0.1.0' } });
  assert.equal(calls, 2);
  await updates.backgroundCheck({ ...options, manifest: { name: 'achernar-code', version: '0.3.0' }, fetcher: async () => { throw new Error('offline'); } });
});
