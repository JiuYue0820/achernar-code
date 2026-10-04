const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
test('imported model profiles retain validated prices for a cost-governed fallback chain', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-governance-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'models.json'), library = require('../cli/library').createCliLibrary(path.resolve(__dirname, '..'), path.join(root, 'home'));
  fs.writeFileSync(file, JSON.stringify([{ modelId: 'backup', baseUrl: 'https://example.invalid/v1', keyEnv: 'BACKUP_KEY', pricing: { input: 1, output: 2 } }]));
  assert.deepEqual(library.importModels(file)[0].pricing, { input: 1, output: 2 });
  fs.writeFileSync(file, JSON.stringify([{ modelId: 'backup', baseUrl: 'https://example.invalid/v1', pricing: { input: -1, output: 2 } }]));
  assert.throws(() => library.importModels(file), /Pricing/);
});
test('pricing and budget commands validate persisted amounts and support disabling a cap', async () => {
  let config = {}, notices = [];
  const context = { settings: () => config, saveSettings: changes => { config = { ...config, ...changes }; }, notice: value => notices.push(value) };
  const { configureGovernance } = require('../cli/governance-menu');
  await assert.rejects(configureGovernance('budget', '1', context), /pricing/i);
  await configureGovernance('pricing', '1 2', context);
  await configureGovernance('budget', '0.25', context); assert.equal(config.maxCost, .25);
  await configureGovernance('budget', 'off', context); assert.equal(config.maxCost, null);
});
test('changing a model does not silently reuse the previous model pricing', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-price-scope-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ modelId: 'first', baseUrl: 'http://localhost:8000/v1', pricing: { input: 1, output: 2 } }));
  const call = args => require('node:child_process').spawnSync(process.execPath, [path.resolve(__dirname, '../cli/index.js'), '--json', ...args], { windowsHide: true, encoding: 'utf8', env: { ...process.env, ACHERNAR_CLI_HOME: root, ACHERNAR_MODEL: '', ACHERNAR_BASE_URL: '', ACHERNAR_API_KEY: '' } });
  const overridden = JSON.parse(call(['--model', 'second', 'config', 'show']).stdout).data;
  assert.ok(overridden.pricing == null, 'a one-shot model override must not use unrelated prices');
  const changed = call(['--model', 'second', 'config', 'set']); assert.equal(changed.status, 0, changed.stdout);
  assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')).pricing == null);
});
