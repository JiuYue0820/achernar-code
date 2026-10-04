const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { withMcp } = require('../src/services/mcp');

const root = path.resolve(__dirname, '..');
const plugin = name => path.join(root, 'extensions', 'plugins', 'achernar', name);
const textOf = response => JSON.parse(response.content[0].text);

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

test('web search MCP discovers tools and returns traceable local RSS results', async t => {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/rss+xml');
    response.end(`<?xml version="1.0"?><rss><channel><item><title>Achernar local test</title><link>https://example.com/docs</link><description>Verified <b>snippet</b></description></item></channel></rss>`);
  });
  const port = await listen(server);
  t.after(() => server.close());
  const mcpServer = { command: process.execPath, args: [path.join(plugin('achernar-web-search'), 'server.js')], cwd: plugin('achernar-web-search'), env: { ACHERNAR_SEARCH_ENDPOINT: `http://127.0.0.1:${port}/search`, ACHERNAR_ALLOW_PRIVATE_NETWORK: '1' } };
  await withMcp(mcpServer, async client => {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name), ['web_search', 'fetch_webpage']);
    const response = textOf(await client.callTool({ name: 'web_search', arguments: { query: 'local test' } }));
    assert.equal(response.provider, 'Bing RSS');
    assert.equal(response.results[0].url, 'https://example.com/docs');
    assert.match(response.results[0].snippet, /Verified snippet/);
  }, AbortSignal.timeout(10000));
});

test('search retries mismatched responses and rejects persistent mismatch and site escapes', async () => {
  const { searchWeb } = require('../extensions/plugins/achernar/achernar-web-search/search');
  const rss = (title, url) => ({ body: Buffer.from(`<rss><channel><item><title>${title}</title><link>${url}</link><description><![CDATA[Useful <b>snippet</b>]]></description></item></channel></rss>`) });
  const queries = [];
  const found = await searchWeb({ query: 'Model Context Protocol official documentation' }, async url => {
    queries.push(url.searchParams.get('q'));
    return queries.length === 1 ? rss('Model Y', 'https://example.com/car') : rss('Model Context Protocol', 'https://modelcontextprotocol.io');
  });
  assert.equal(queries.length, 2);
  assert.equal(found.effectiveQuery, '"model context protocol"');
  assert.equal(found.results[0].snippet, 'Useful snippet');
  assert.equal(found.attempts[0].resultCount, 0);
  await assert.rejects(searchWeb({ query: 'Achernar star' }, async () => rss('Microsoft account', 'https://example.com')), /no relevant results/);
  await assert.rejects(searchWeb({ query: 'site:electronjs.org Electron' }, async () => rss('Electron docs', 'https://electronjs.org.evil.example')), /no relevant results/);
});

test('search falls back to real 360 target URLs and rejects captcha and generated answers', async () => {
  const { searchWeb } = require('../extensions/plugins/achernar/achernar-web-search/search');
  const found = await searchWeb({ query: 'Achernar star' }, async url => ({ body: Buffer.from(url.hostname === 'www.so.com'
    ? '<ul><li class="res-list"><h3 class="res-title"><a href="/link?opaque" data-mdurl="https://www.space.com/23570-achernar.html">Achernar: Binary Star</a></h3><p class="res-desc">A fast rotating star.</p></li><li class="res-list"><h3 class="res-title"><a href="https://ai.so.com/search">Achernar star generated answer</a></h3></li></ul>'
    : '<rss><channel><item><title>Microsoft account</title><link>https://example.com</link></item></channel></rss>') }));
  assert.equal(found.provider, '360 Search');
  assert.equal(found.attempts.length, 3);
  assert.equal(found.results.length, 1);
  assert.equal(found.results[0].url, 'https://www.space.com/23570-achernar.html');
  assert.match(found.results[0].snippet, /rotating/);
  await assert.rejects(searchWeb({ query: 'Achernar star', provider: '360' }, async () => ({ body: Buffer.from('<h1>Verify you are human</h1>') })), /no relevant/);
});
test('long mixed-language search relaxes automatically, preserves site filters and reports English errors', async () => {
  const { searchWeb } = require('../extensions/plugins/achernar/achernar-web-search/search');
  const query = 'Achernar beta 船底座 星 距离 光度 大小 物理参数 site:space.com', attempts = [];
  const found = await searchWeb({ query }, async url => {
    const q = url.searchParams.get('q'); attempts.push(q);
    return { body: Buffer.from(q === 'achernar site:space.com'
      ? '<li class="res-list"><h3 class="res-title"><a href="https://www.space.com/23570-achernar.html">Achernar: a binary star</a></h3><p class="res-desc">An astronomy article</p></li>'
      : '<rss><channel></channel></rss>') };
  });
  assert.equal(found.queryRelaxed, true); assert.equal(found.results[0].url, 'https://www.space.com/23570-achernar.html');
  assert.ok(attempts.every(q => q.includes('site:space.com')));
  await assert.rejects(searchWeb({ query }, async () => ({ body: Buffer.from('<rss/>') })), error => {
    assert.equal(error.code, 'WEB_SEARCH_EMPTY'); assert.ok(!/[\u3400-\u9fff]/.test(error.message)); assert.ok(error.attempts.length >= 4); return true;
  });
});

test('JSON MCP validates, formats, resolves escaped pointers and rejects prototype access', async () => {
  await withMcp({ command: process.execPath, args: [path.join(plugin('achernar-json-tools'), 'server.js')] }, async client => {
    assert.equal((await client.listTools()).tools.length, 2);
    const selected = textOf(await client.callTool({ name: 'json_inspect', arguments: { json: '{"a/b":{"~x":[42]}}', pointer: '/a~1b/~0x/0' } }));
    assert.equal(selected.value, 42);
    const formatted = textOf(await client.callTool({ name: 'json_format', arguments: { json: '{"ok":true}', indent: 2 } }));
    assert.deepEqual(JSON.parse(formatted.formatted), { ok: true });
    for (const args of [{ json: '{broken' }, { json: '{}', pointer: '/toString' }, { json: '{}', pointer: '/~2' }]) {
      assert.equal((await client.callTool({ name: 'json_inspect', arguments: args })).isError, true);
    }
    const large = textOf(await client.callTool({ name: 'json_inspect', arguments: { json: JSON.stringify('x'.repeat(200)), maxChars: 100 } }));
    assert.equal(large.truncated, true);
    assert.equal(large.preview.length, 100);
  }, AbortSignal.timeout(10000));
});

test('Git MCP inspects real repository changes without modifying files', async t => {
  const exec = require('node:util').promisify(require('node:child_process').execFile);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-git-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const git = args => exec('git', ['-C', directory, ...args], { windowsHide: true });
  await git(['init']);
  fs.writeFileSync(path.join(directory, 'note.txt'), 'before\n');
  await git(['add', '--', 'note.txt']);
  await git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'Initial fixture']);
  fs.writeFileSync(path.join(directory, 'note.txt'), 'after\n');
  await withMcp({ command: process.execPath, args: [path.join(plugin('achernar-git-tools'), 'server.js')], env: { ACHERNAR_PROJECT_ROOT: directory } }, async client => {
    assert.equal((await client.listTools()).tools.length, 3);
    assert.match(textOf(await client.callTool({ name: 'git_status', arguments: {} })).output, /note.txt/);
    assert.match(textOf(await client.callTool({ name: 'git_log', arguments: { count: 1 } })).output, /Initial fixture/);
    assert.match(textOf(await client.callTool({ name: 'git_diff', arguments: { file: 'note.txt' } })).output, /\+after/);
    assert.equal((await client.callTool({ name: 'git_status', arguments: { repo: '..' } })).isError, true);
    assert.equal((await client.callTool({ name: 'git_diff', arguments: { file: '../outside' } })).isError, true);
    assert.equal(fs.readFileSync(path.join(directory, 'note.txt'), 'utf8'), 'after\n');
  }, AbortSignal.timeout(15000));
});

test('npm MCP returns paginated metadata and rejects path-shaped package names', async t => {
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(request.url.startsWith('/-/v1/search')
      ? { total: 8, objects: [{ package: { name: 'electron', version: '31.0.0', links: { npm: 'https://www.npmjs.com/package/electron' } } }] }
      : { name: 'electron', version: '31.0.0', license: 'MIT' }));
  });
  const port = await listen(server);
  t.after(() => server.close());
  await withMcp({ command: process.execPath, args: [path.join(plugin('achernar-package-tools'), 'server.js')], env: {
    ACHERNAR_NPM_REGISTRY: `http://127.0.0.1:${port}/`, ACHERNAR_ALLOW_PRIVATE_NETWORK: '1'
  } }, async client => {
    assert.equal((await client.listTools()).tools.length, 2);
    const found = textOf(await client.callTool({ name: 'npm_search', arguments: { query: 'electron', limit: 1, offset: 2 } }));
    assert.equal(found.items[0].name, 'electron');
    assert.equal(found.nextOffset, 3);
    const item = textOf(await client.callTool({ name: 'npm_package', arguments: { name: 'electron', version: '31.0.0' } }));
    assert.equal(item.license, 'MIT');
    assert.equal((await client.callTool({ name: 'npm_package', arguments: { name: '../package' } })).isError, true);
  }, AbortSignal.timeout(10000));
});

test('project tools MCP stays read-only and inside the configured project', async () => {
  const mcpServer = { command: process.execPath, args: [path.join(plugin('achernar-project-tools'), 'server.js')], cwd: plugin('achernar-project-tools'), env: { ACHERNAR_PROJECT_ROOT: root } };
  await withMcp(mcpServer, async client => {
    const overview = textOf(await client.callTool({ name: 'project_overview', arguments: { path: 'extensions' } }));
    assert.equal(overview.path, 'extensions');
    const match = textOf(await client.callTool({ name: 'search_project', arguments: { query: 'achernar-web-search', path: 'extensions', maxResults: 5 } }));
    assert.ok(match.matches.some(item => item.path.includes('catalog.json')));
    const escaped = await client.callTool({ name: 'read_project_file', arguments: { path: '../package.json' } });
    assert.equal(escaped.isError, true);
    assert.match(escaped.content[0].text, /leaves/);
  }, AbortSignal.timeout(10000));
});

test('runtime checks report endpoint authentication without accepting a key', async t => {
  const server = http.createServer((_request, response) => {
    response.statusCode = 401;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ error: { type: 'auth_error', message: 'Token required' } }));
  });
  const port = await listen(server);
  t.after(() => server.close());
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-wav-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const sampleBytes = 32000;
  const wav = Buffer.alloc(44 + sampleBytes);
  wav.write('RIFF', 0, 'ascii'); wav.writeUInt32LE(36 + sampleBytes, 4); wav.write('WAVE', 8, 'ascii'); wav.write('fmt ', 12, 'ascii'); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36, 'ascii'); wav.writeUInt32LE(sampleBytes, 40);
  const wavPath = path.join(temp, 'empty.wav'); fs.writeFileSync(wavPath, wav);
  const mcpServer = { command: process.execPath, args: [path.join(plugin('achernar-runtime-checks'), 'server.js')], cwd: plugin('achernar-runtime-checks'), env: { ACHERNAR_ALLOW_PRIVATE_NETWORK: '1' } };
  await withMcp(mcpServer, async client => {
    const metadata = textOf(await client.callTool({ name: 'inspect_wav', arguments: { path: wavPath } }));
    assert.equal(metadata.sampleRate, 16000);
    const probe = textOf(await client.callTool({ name: 'probe_openai_endpoint', arguments: { baseUrl: `http://127.0.0.1:${port}/v1` } }));
    assert.equal(probe.reachable, true);
    assert.equal(probe.authenticationRequired, true);
  }, AbortSignal.timeout(10000));
});
