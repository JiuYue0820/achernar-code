'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { saveSettings } = require('../cli/settings-save');
test('settings save encrypts keys, resets endpoint-bound settings and synchronizes command overrides', () => {
  const initial = { baseUrl: 'https://first.invalid/v1', modelId: 'first', apiFormat: 'openai-chat-completions', credentialId: 'old', pricing: { input: 1, output: 2 }, unrelated: 42 };
  let saved; const overrides = new Map(), stored = [];
  const context = { settings: () => initial, config: () => initial, configPath: 'fixture',
    write: (file, value) => { assert.equal(file, 'fixture'); saved = value; },
    program: { setOptionValue: (key, value) => overrides.set(key, value) },
    credentials: { set: (...args) => { stored.push(args); return 'encrypted-ref'; } } };
  saveSettings({ baseUrl: 'https://second.invalid/v1', modelId: 'second', apiKey: 'fixture-secret' }, context);
  assert.equal(saved.credentialId, 'encrypted-ref'); assert.equal(saved.pricing, null);
  assert.equal(saved.unrelated, 42); assert.ok(!Object.hasOwn(saved, 'apiKey'));
  assert.deepEqual(stored[0], ['https://second.invalid/v1', 'openai-chat-completions', 'fixture-secret']);
  assert.equal(overrides.get('baseUrl'), 'https://second.invalid/v1'); assert.equal(overrides.get('model'), 'second');
  saveSettings({ baseUrl: 'https://third.invalid/v1' }, context);
  assert.equal(saved.credentialId, null);
  saveSettings({ language: 'ru' }, context);
  assert.equal(saved.credentialId, 'old'); assert.deepEqual(saved.pricing, initial.pricing);
  assert.equal(overrides.get('language'), 'ru');
});
test('configuration cache observes external edits and never shares mutable objects', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-config-reader-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, 'config.json'), read = require('../cli/config-store').createConfigReader(file);
  assert.deepEqual(read(), {});
  fs.writeFileSync(file, '{"nested":{"value":1}}');
  const first = read(); first.nested.value = 99;
  assert.equal(read().nested.value, 1);
  fs.writeFileSync(file, '{"nested":{"value":222}}');
  assert.equal(read().nested.value, 222);
  fs.unlinkSync(file); assert.deepEqual(read(), {});
  fs.writeFileSync(file, '{'); assert.throws(read, SyntaxError);
});
test('machine error classification preserves explicit service codes and separates common failures', () => {
  const { errorCode } = require('../cli/errors');
  for (const [error, expected] of [
    [{ code: 'COST_LIMIT', message: 'limit' }, 'COST_LIMIT'],
    [{ status: 429 }, 'PROVIDER_RATE_LIMIT'],
    [{ status: 503 }, 'PROVIDER_UNAVAILABLE'],
    [{ name: 'TimeoutError' }, 'TASK_TIMEOUT'],
    [{ name: 'AbortError' }, 'TASK_CANCELED'],
    [new Error('Session is already running'), 'SESSION_BUSY'],
    [new Error('Session not found'), 'SESSION_NOT_FOUND'],
    [new Error('fetch failed'), 'NETWORK_ERROR'],
  ]) assert.equal(errorCode(error), expected);
});
