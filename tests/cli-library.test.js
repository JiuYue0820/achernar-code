const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createCliLibrary } = require('../cli/library');
const { withMcp } = require('../src/services/mcp');
const root = path.resolve(__dirname, '..');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-cli-library-'));
test('official extensions remain available after user imports; plugin MCP import is disabled', async () => {
  const home = temp(), lib = createCliLibrary(root, home), original = lib.list().filter(e => e.protected);
  const source = path.join(home, 'skill-source'); fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: test-skill\ndescription: Test importing a skill.\n---\nUse read-only inspection.');
  const imported = await lib.importExtension(source, 'skills'); assert.match(lib.detail(imported.id).content, /read-only inspection/);
  const plugin = path.join(home, 'plugin-source'); fs.mkdirSync(plugin); fs.writeFileSync(path.join(plugin, 'README.md'), '# Imported plugin'); fs.writeFileSync(path.join(plugin, '.mcp.json'), JSON.stringify({ mcpServers: { example: { command: 'node', args: ['${pluginRoot}/server.js'] } } }));
  const addition = await lib.importExtension(plugin, 'plugins'); const server = lib.servers(root).find(s => s.extensionId === addition.id); assert.equal(server.enabled, false); assert.ok(server.args[0].startsWith(path.join(home, 'extensions')));
  assert.deepEqual(lib.list().filter(e => e.protected).map(e => e.id), original.map(e => e.id)); assert.ok(original.some(e => e.kind === 'plugins'));
});
test('MCP JSON import validates credentials and only enables explicitly; official JSON tool executes', async () => {
  const home = temp(), lib = createCliLibrary(root, home), file = path.join(home, 'mcp.json');
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { local: { command: 'node', args: [], env: { TOKEN: '${env:ACHERNAR_TEST_TOKEN}' } } } }));
  const [entry] = await lib.importMcp(file); assert.equal(lib.servers(root).find(s => s.id === entry.id).enabled, false);
  assert.doesNotThrow(() => lib.servers(root, true)); // disabled credentials are never needed
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { unsafe: { command: 'node', env: { TOKEN: 'do-not-store-me' } } } }));
  await assert.rejects(lib.importMcp(file), /environment|env:/); assert.ok(!fs.readFileSync(path.join(home, 'integrations.json'), 'utf8').includes('do-not-store-me'));
  const official = lib.servers(root, true).find(s => s.name === 'achernar-json-tools'); assert.ok(official.enabled);
  await withMcp(official, async client => { const result = await client.callTool({ name: 'json_inspect', arguments: { json: '{"test":42}', pointer: '/test' } }); assert.equal(JSON.parse(result.content[0].text).value, 42); }, AbortSignal.timeout(10000));
});
test('model profiles import without credentials and deduplicate by endpoint/model/format', () => {
  const home = temp(), lib = createCliLibrary(root, home), file = path.join(home, 'models.json');
  fs.writeFileSync(file, JSON.stringify({ models: [{ name: 'Local coder', modelId: 'coder', baseUrl: 'http://localhost:11434/v1', apiFormat: 'openai-chat-completions', contextWindow: 64000, keyEnv: 'LOCAL_KEY' }] }));
  lib.importModels(file); lib.importModels(file); assert.equal(lib.profiles().length, 1); assert.equal(lib.profiles()[0].contextWindow, 64000);
  fs.writeFileSync(file, JSON.stringify({ modelId: 'bad', baseUrl: 'http://localhost:11434/v1', apiKey: 'secret' })); assert.throws(() => lib.importModels(file), /inline credentials/);
});
test('download package preserves CLI official resources and excludes desktop implementations', async () => {
  const home = temp(), output = path.join(home, 'cli.zip'); await require('../src/services/cli-package').buildCliPackage(root, output);
  const zip = await require('jszip').loadAsync(fs.readFileSync(output));
  for (const file of ['cli/session-records.js', 'src/services/task-notifications.js', 'src/services/windows-notifications.js', 'src/services/windows-notifications.ps1', 'src/services/execution-context.js']) assert.ok(zip.file(file), file);
  const catalog = JSON.parse(await zip.file('extensions/catalog.json').async('string'));
  const official = JSON.parse(fs.readFileSync(path.join(root, 'extensions/catalog.json'), 'utf8')).filter(require('../cli/extension-policy').isCliExtension);
  assert.deepEqual(catalog.map(e => e.id), official.map(e => e.id));
  for (const file of ['src/services/tools.js', 'src/services/agent-desktop-host.js', 'src/services/computer.js', 'src/services/memory.js', 'src/services/skill-policy.js']) assert.equal(zip.file(file), null, file);
  assert.ok(zip.file('src/services/core-tools.js'));
  assert.ok(!Object.keys(zip.files).some(file => /achernar-(computer-use|windows-automation|desktop-pet|appearance|voice-stack)\//.test(file)));
  for (const entry of catalog) assert.ok(zip.file('extensions/' + entry.document), entry.id);
  for (const name of ['extensions/lib/mcp-server.js', 'extensions/plugins/achernar/achernar-json-tools/server.js', 'extensions/plugins/achernar/achernar-json-tools/.mcp.json', 'cli/library.js', 'cli/manage-integrations.js']) assert.ok(zip.file(name), name);
  assert.ok(JSON.parse(await zip.file('package.json').async('string')).dependencies.zod);
  const manifest = JSON.parse(await zip.file('package.json').async('string')), locked = JSON.parse(await zip.file('package-lock.json').async('string'));
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(root, 'cli/package-manifest.json'), 'utf8'));
  assert.equal(manifest.version, sourceManifest.version); assert.equal(locked.version, manifest.version);
  assert.equal(manifest.name, 'achernar-code'); assert.equal(manifest.private, undefined);
  assert.equal(manifest.publishConfig.tag, 'next'); assert.ok(!manifest.files.includes('outputs/'));
  assert.deepEqual(locked.packages[''].dependencies, manifest.dependencies);
  assert.ok(Object.values(manifest.dependencies).every(v => /^\d+\.\d+\.\d+$/.test(v)));
  assert.ok(zip.file('THIRD_PARTY_NOTICES.md'));
  assert.ok((await zip.file('RELEASE_NOTES.md').async('string')).includes(manifest.version));
  assert.ok(zip.file('README.zh-CN.md')); assert.ok(zip.file('USAGE.md'));
  for (const template of ['workbench', 'data-overview', 'editorial']) {
    const file = `extensions/skills/achernar/achernar-ui-design/assets/templates/${template}.html`;
    assert.equal(await zip.file(file).async('string'), fs.readFileSync(path.join(root, file), 'utf8'));
  }
});
