'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path');
async function runMatrix(
  {
    models,
    out,
    live,
    fixture,
    threshold = 1,
    setup,
    taskTimeoutMs = 120000,
    maxRounds = 12,
    maxOutputTokens = 4096,
    task,
    maxCost,
  },
  { run = require('./index').main, log = () => {} } = {},
) {
  if (
    !Array.isArray(models) ||
    !models.length ||
    models.length > 8 ||
    new Set(models).size !== models.length ||
    models.some((id) => typeof id !== 'string' || !id.trim() || id.length > 256 || /\s/.test(id))
  )
    throw new Error('Provide 1–8 distinct nonempty model IDs.');
  if (Boolean(live) === Boolean(fixture))
    throw new Error('Choose live models or fixture verification.');
  if (!Number.isFinite(Number(threshold)) || Number(threshold) < 0 || Number(threshold) > 1)
    throw new Error('Pass threshold must be between zero and one');
  const profiles = models.map((modelId) => ({
    ...setup,
    modelId,
    ...require('../../src/reasoning').forModel(setup, { modelId }),
    ...(modelId !== setup.modelId ? { pricing: null, contextWindow: 32768 } : {}),
  }));
  if (maxCost != null && profiles.some((profile) => !profile.pricing))
    throw new Error(
      'Every matrix model needs its own pricing before applying a cost cap. Run separately with explicit rates.',
    );
  const totalTasks = task
    ? require('./tasks').tasks.filter((t) => t.id === task).length
    : require('./tasks').tasks.length;
  if (!totalTasks) throw new Error('Unknown evaluation task.');
  const root = path.resolve(out);
  await fs.mkdir(path.dirname(root), { recursive: true });
  await fs.mkdir(root, { recursive: false });
  const results = [];
  for (const [index, profile] of profiles.entries()) {
    const directory = path.join(
      root,
      String(index + 1).padStart(2, '0') +
        '-' +
        profile.modelId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60),
    );
    try {
      const report = await run(
        [
          'node',
          'eval',
          live ? '--live' : '--fixture',
          '--out',
          directory,
          '--threshold',
          String(threshold),
          '--task-timeout-ms',
          String(taskTimeoutMs),
          '--max-rounds',
          String(maxRounds),
          '--max-output-tokens',
          String(maxOutputTokens),
          ...(task ? ['--task', task] : []),
          ...(maxCost != null ? ['--max-cost', String(maxCost)] : []),
        ],
        { setup: profile, log },
      );
      results.push({ model: profile.modelId, directory, ...report });
    } catch (error) {
      results.push({
        model: profile.modelId,
        endpoint: profile.baseUrl,
        directory,
        ok: false,
        passed: 0,
        total: totalTasks,
        passRate: 0,
        error: require('../session-export').redact(error.message, { secrets: [profile.apiKey] }),
      });
    }
    await fs.writeFile(path.join(root, 'matrix-progress.json'), JSON.stringify(results, null, 2));
  }
  const passed = results.reduce((sum, r) => sum + r.passed, 0),
    total = results.reduce((sum, r) => sum + r.total, 0);
  const report = {
    ok: results.every((r) => r.ok),
    kind: live ? 'live-model-matrix' : 'deterministic-fixture-matrix',
    measuredAt: new Date().toISOString(),
    threshold: Number(threshold),
    passed,
    total,
    passRate: total ? passed / total : 0,
    results,
    note: 'Every model must meet the threshold independently. Small coding suite, not a product ranking; failures remain in the denominator.',
  };
  await fs.writeFile(path.join(root, 'matrix-report.json'), JSON.stringify(report, null, 2));
  return report;
}
module.exports = { runMatrix };
