const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
test('model matrix runs every explicit model and retains failures without unrelated pricing', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'achernar-matrix-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { runMatrix } = require('../cli/eval/matrix'), profiles = [];
  const report = await runMatrix({ models: ['one', 'two'], out: path.join(root, 'run'), live: true, threshold: 1, setup: { modelId: 'one', baseUrl: 'http://localhost/v1', apiKey: 'matrix-secret', pricing: { input: 1, output: 2 }, contextWindow: 100000 } }, {
    run: async (argv, { setup }) => { profiles.push(setup); return { model: setup.modelId, endpoint: setup.baseUrl, passed: setup.modelId === 'one' ? 3 : 2, total: 3, passRate: setup.modelId === 'one' ? 1 : 2 / 3, ok: setup.modelId === 'one' }; },
  });
  assert.equal(report.ok, false); assert.equal(report.passed, 5); assert.equal(report.total, 6);
  assert.equal(profiles[0].pricing.input, 1); assert.equal(profiles[1].pricing, null);
  assert.equal(profiles[1].contextWindow, 32768);
  assert.doesNotMatch(await fs.readFile(path.join(root, 'run/matrix-report.json'), 'utf8'), /matrix-secret/);
});
test('matrix configuration errors fail before any model request', async t => {
  const { runMatrix } = require('../cli/eval/matrix');
  let called = false;
  for (const models of [[], ['a', 'a'], ['a', ''], Array.from({ length: 9 }, (_, i) => String(i))]) {
    await assert.rejects(runMatrix({ models, out: 'unused', live: true, setup: {} }, { run: async () => { called = true; } }), /model/i);
  }
  assert.equal(called, false);
});
