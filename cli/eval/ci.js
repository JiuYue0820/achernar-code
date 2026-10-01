'use strict';
// A trusted CI job must provide its own configuration. Never load a runner's
// personal model profile or silently downgrade missing live credentials to fixtures.
async function runCiEval(env = process.env, { run = require('./index').main } = {}) {
  const required = ['ACHERNAR_EVAL_API_KEY', 'ACHERNAR_EVAL_BASE_URL', 'ACHERNAR_EVAL_MODELS'];
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length)
    throw new Error(
      'Configure ' + missing.join(', ') + ' before running the live regression gate.',
    );
  const models = env.ACHERNAR_EVAL_MODELS.split(',').map((value) => value.trim());
  if (
    models.length < 2 ||
    models.length > 8 ||
    new Set(models).size !== models.length ||
    models.some((id) => !id || id.length > 256 || /\s/.test(id))
  ) {
    throw new Error('Configure 2–8 distinct model IDs in ACHERNAR_EVAL_MODELS.');
  }
  let endpoint;
  try {
    endpoint = new URL(env.ACHERNAR_EVAL_BASE_URL);
  } catch {
    throw new Error('Configure ACHERNAR_EVAL_BASE_URL as an HTTP(S) endpoint.');
  }
  if (
    !['https:', 'http:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error(
      'Configure ACHERNAR_EVAL_BASE_URL without credentials, query parameters or fragments.',
    );
  }
  return run(
    [
      'node',
      'eval',
      '--live',
      '--models',
      models.join(','),
      '--out',
      'output/eval-live',
      '--threshold',
      '1',
      '--task-timeout-ms',
      '90000',
      '--max-rounds',
      '10',
    ],
    {
      setup: {
        modelId: models[0],
        baseUrl: endpoint.toString().replace(/\/$/, ''),
        apiKey: env.ACHERNAR_EVAL_API_KEY,
        apiFormat: env.ACHERNAR_EVAL_API_FORMAT || 'openai-chat-completions',
        contextWindow: 32768,
        pricing: null,
      },
    },
  );
}
if (require.main === module)
  runCiEval()
    .then((report) => {
      if (!report.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(
        require('../session-export').redact(error.message, {
          secrets: [process.env.ACHERNAR_EVAL_API_KEY],
        }),
      );
      process.exitCode = 1;
    });
module.exports = { runCiEval };
