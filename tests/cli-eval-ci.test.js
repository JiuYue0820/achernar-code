const test = require('node:test'), assert = require('node:assert/strict');
test('live CI gate fails closed when credentials, endpoint or multiple explicit models are missing', async () => {
  const { runCiEval } = require('../cli/eval/ci');
  const configured = { ACHERNAR_EVAL_API_KEY: 'fixture-secret', ACHERNAR_EVAL_BASE_URL: 'https://provider.invalid/v1', ACHERNAR_EVAL_MODELS: 'model-a,model-b' };
  for (const key of Object.keys(configured)) {
    const env = { ...configured }; delete env[key];
    await assert.rejects(runCiEval(env, { run: () => assert.fail('No request before complete setup') }), /Configure ACHERNAR_EVAL/);
  }
  for (const models of ['model-a', 'model-a,model-a', 'model-a,', 'model-a,white space']) {
    await assert.rejects(runCiEval({ ...configured, ACHERNAR_EVAL_MODELS: models }, { run: () => assert.fail('Invalid matrix') }), /distinct model IDs/);
  }
});
test('live CI gate uses a full real-model matrix and never replaces a failed run with fixtures', async () => {
  const { runCiEval } = require('../cli/eval/ci');
  const env = { ACHERNAR_EVAL_API_KEY: 'fixture-secret', ACHERNAR_EVAL_BASE_URL: 'https://provider.invalid/v1', ACHERNAR_EVAL_MODELS: 'model-a,model-b', ACHERNAR_EVAL_API_FORMAT: 'anthropic-messages' };
  const report = { ok: false, passed: 7, total: 10, kind: 'live-model-matrix' };
  let calls = 0;
  const result = await runCiEval(env, { run: async (argv, { setup }) => {
    calls++;
    assert.ok(argv.includes('--live')); assert.ok(!argv.includes('--fixture')); assert.ok(!argv.includes('--task'));
    assert.equal(argv[argv.indexOf('--threshold') + 1], '1');
    assert.equal(argv[argv.indexOf('--models') + 1], 'model-a,model-b');
    assert.equal(setup.apiKey, 'fixture-secret'); assert.equal(setup.apiFormat, 'anthropic-messages');
    assert.equal(setup.modelId, 'model-a'); assert.equal(setup.pricing, null);
    return report;
  } });
  assert.equal(calls, 1); assert.equal(result, report);
});
