const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { setupVscode, packExtension, importBundle } = require('../cli/integration-kit');
const { createCliLibrary } = require('../cli/library');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-kit-test-'));
test('VS Code preview does not write, setup preserves user tasks and is idempotent', async () => {
  const root = temp(), file = path.join(root, '.vscode/tasks.json');
  const preview = await setupVscode(root); assert.equal(preview.written, false); assert.ok(!fs.existsSync(file));
  fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, '{"version":"2.0.0","tasks":[{"label":"user build","command":"custom"}]}');
  const saved = await setupVscode(root, true);
  assert.equal(saved.tasks.tasks[0].command, 'custom'); assert.equal(saved.added.length, 3);
  assert.equal((await setupVscode(root, true)).added.length, 0);
  fs.writeFileSync(file, '{// comment\n"tasks":[]}');
  await assert.rejects(setupVscode(root, true), /not changed/);
  assert.match(fs.readFileSync(file, 'utf8'), /comment/);
});
test('portable plugin bundles round-trip, verify file hashes, reject traversal and keep MCP disabled', async () => {
  const root = temp(), source = path.join(root, 'sample-plugin'), bundle = path.join(root, 'plugin.json');
  fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'README.md'), '# Test plugin');
  fs.writeFileSync(path.join(source, '.mcp.json'), JSON.stringify({ mcpServers: { example: { command: 'node', args: ['${pluginRoot}/server.js'] } } }));
  fs.writeFileSync(path.join(source, 'server.js'), 'throw new Error("must not execute during import");');
  const packed = await packExtension(source, 'plugins', bundle); assert.equal(packed.files, 3);
  const library = createCliLibrary(path.resolve(__dirname, '..'), path.join(root, 'home'));
  const item = await importBundle(bundle, library);
  assert.equal(library.detail(item.id).content, '# Test plugin');
  assert.equal(library.servers(root).find(server => server.extensionId === item.id).enabled, false);
  const original = JSON.parse(fs.readFileSync(bundle, 'utf8'));
  const corrupt = structuredClone(original); corrupt.files[0].sha256 = 'bad';
  fs.writeFileSync(bundle, JSON.stringify(corrupt)); await assert.rejects(importBundle(bundle, library), /hash/);
  for (const value of ['../escape.js', '/absolute.js', 'C:/bad.js', 'a\\b.js', 'CON.js', 'a.']) {
    const unsafe = structuredClone(original); unsafe.files[0].path = value;
    fs.writeFileSync(bundle, JSON.stringify(unsafe)); await assert.rejects(importBundle(bundle, library), /Unsafe/);
  }
  fs.writeFileSync(path.join(source, '.env'), 'SECRET=placeholder');
  await assert.rejects(packExtension(source, 'plugins'), /private configuration/);
});
test('CLI extension catalog excludes desktop control resources while desktop catalog is preserved', () => {
  const root = path.resolve(__dirname, '..'), library = createCliLibrary(root, temp()), items = library.list();
  for (const name of ['achernar-computer-use', 'achernar-desktop-pet', 'achernar-windows-automation', 'achernar-appearance', 'achernar-memory', 'achernar-voice-stack']) {
    assert.ok(!items.some(item => item.name === name), name);
    assert.ok(!library.servers(root).some(server => server.name === name), name);
  }
  for (const name of ['achernar-coding', 'achernar-ui-design', 'achernar-web-research', 'achernar-git-tools']) assert.ok(items.some(item => item.name === name));
});
