const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
test('standalone archive includes task input, workbench and process-limit runtime modules', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'achernar-package-resources-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const destination = path.join(root, 'cli.zip');
  await require('../src/services/cli-package').buildCliPackage(path.resolve(__dirname, '..'), destination);
  const zip = await require('jszip').loadAsync(await fs.readFile(destination));
  for (const name of ['cli/task-input.js', 'cli/workbench-commands.js', 'cli/windows-job.ps1']) {
    assert.ok(zip.file(name), `${name} must be usable after installation outside the source tree`);
  }
});
