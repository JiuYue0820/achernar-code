'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
test('release metadata requires the CLI name, matching tag, channel and absence of desktop entry points', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-release-metadata-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'cli'));
  const candidates = [path.join(__dirname, '../scripts/release-metadata.js'), path.join(__dirname, '../cli/publish/scripts/release-metadata.js')];
  fs.copyFileSync(candidates.find(file => fs.existsSync(file)), path.join(root, 'scripts/release-metadata.js'));
  fs.copyFileSync(path.join(__dirname, '../cli/updates.js'), path.join(root, 'cli/updates.js'));
  const manifest = { name: 'achernar-code', version: '0.2.0-rc.5', bin: { achernar: 'cli/index.js' }, publishConfig: { tag: 'next' } };
  const run = (changes = {}, tag = 'v0.2.0-rc.5') => {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ ...manifest, ...changes }));
    return spawnSync(process.execPath, [path.join(root, 'scripts/release-metadata.js')], {
      cwd: root, windowsHide: true, encoding: 'utf8',
      env: { ...process.env, GITHUB_REF_NAME: tag, GITHUB_OUTPUT: path.join(root, 'result.txt') },
    });
  };
  const ok = run(); assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).channel, 'next');
  assert.match(fs.readFileSync(path.join(root, 'result.txt'), 'utf8'), /tarball=achernar-code-0.2.0-rc.5.tgz/);
  for (const [changes, tag] of [[{ name: 'achernar' }], [{ main: 'main.js' }], [{ publishConfig: { tag: 'latest' } }], [{}, 'v0.2.0']]) {
    assert.notEqual(run(changes, tag).status, 0);
  }
  assert.equal(run({ version: '0.2.0', publishConfig: { tag: 'latest' } }, 'v0.2.0').status, 0);
  fs.writeFileSync(path.join(root, 'main.js'), '');
  assert.match(run().stderr, /Desktop source is not allowed/);
});
