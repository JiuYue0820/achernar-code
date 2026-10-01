#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  http = require('node:http');
const { spawn } = require('node:child_process'),
  { createHash } = require('node:crypto');
const { Command } = require('commander'),
  { tasks } = require('./tasks'),
  { evaluateReport, executionMetrics } = require('./report');
const reasoning = require('../../src/reasoning');
function resolveEvalProfile(saved, env, getCredential) {
  const apiFormat = env.ACHERNAR_API_FORMAT || saved.apiFormat || 'openai-chat-completions';
  const baseUrl = env.ACHERNAR_BASE_URL || saved.baseUrl,
    modelId = env.ACHERNAR_MODEL || saved.modelId;
  const endpoint = (value) =>
    String(value || '')
      .trim()
      .replace(/\/+$/, '');
  const sameEndpoint =
    endpoint(baseUrl) === endpoint(saved.baseUrl) &&
    apiFormat === (saved.apiFormat || 'openai-chat-completions');
  const sameModel = sameEndpoint && modelId === saved.modelId;
  const standardKey =
    apiFormat === 'anthropic-messages'
      ? 'ANTHROPIC_API_KEY'
      : apiFormat === 'gemini'
        ? 'GEMINI_API_KEY'
        : 'OPENAI_API_KEY';
  const keyEnv = (sameEndpoint && saved.keyEnv) || standardKey;
  const apiKey =
    env.ACHERNAR_API_KEY ||
    env[keyEnv] ||
    (sameEndpoint && saved.credentialId ? getCredential(saved.credentialId) : '');
  return {
    modelId,
    baseUrl,
    apiFormat,
    apiKey,
    ...reasoning.forModel(saved, { modelId, baseUrl, apiFormat }),
    maxOutputTokens: saved.maxOutputTokens,
    pricing: sameModel ? saved.pricing : null,
    contextWindow: sameModel ? saved.contextWindow || 32768 : 32768,
  };
}
async function main(argv = process.argv, { log = (value) => console.log(value), setup } = {}) {
  const command = new Command()
    .option('--live', 'use configured real model (incurs provider usage)')
    .option('--fixture', 'local deterministic transport test; not a quality evaluation')
    .requiredOption('--out <directory>', 'fresh output directory')
    .option('--threshold <number>', 'minimum task pass rate', '1')
    .option('--task-timeout-ms <number>', 'per-task wall-clock deadline', '120000')
    .option('--max-rounds <number>', 'per-task model response limit', '12')
    .option('--max-cost <usd>', 'per-task cost cap; requires configured pricing')
    .option('--task <id>', 'evaluate one fixed task')
    .option('--max-output-tokens <count>', 'per-response limit including thinking; default 4096')
    .option(
      '--models <ids>',
      'comma-separated model IDs on the configured endpoint; evaluate each separately',
    );
  command.parse(argv);
  const opts = command.opts();
  if (Boolean(opts.live) === Boolean(opts.fixture))
    throw new Error('Choose exactly one of --live or --fixture.');
  const selected = opts.task ? tasks.filter((task) => task.id === opts.task) : tasks;
  if (!selected.length) throw new Error('Unknown evaluation task.');
  const deadline = Number(opts.taskTimeoutMs),
    rounds = Number(opts.maxRounds),
    threshold = Number(opts.threshold);
  if (
    !Number.isInteger(deadline) ||
    deadline < 5000 ||
    deadline > 600000 ||
    !Number.isInteger(rounds) ||
    rounds < 1 ||
    rounds > 40
  )
    throw new Error('Eval needs 5–600 seconds per task and 1–40 rounds.');
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw new Error('Pass threshold must be between zero and one');
  const userHome = process.env.ACHERNAR_CLI_HOME || path.join(os.homedir(), '.achernar-cli');
  let saved = setup || {};
  if (!setup)
    try {
      saved = JSON.parse(await fs.readFile(path.join(userHome, 'config.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  const profile = opts.fixture
    ? {
        apiFormat: 'openai-chat-completions',
        modelId: 'deterministic-protocol-fixture',
        baseUrl: 'http://127.0.0.1',
        apiKey: 'fixture-key',
        pricing: { input: 0, output: 0 },
        contextWindow: 32768,
      }
    : setup ||
      resolveEvalProfile(saved, process.env, (id) =>
        require('../credentials').createCredentialStore(userHome).get(id),
      );
  const maxOutputTokens = Number(opts.maxOutputTokens || profile.maxOutputTokens || 4096),
    effort = reasoning.normalize(profile);
  const format = profile.apiFormat || 'openai-chat-completions',
    key = profile.apiKey || '';
  let model = profile.modelId,
    baseUrl = profile.baseUrl;
  if (opts.live && (!model || !baseUrl))
    throw new Error('Configure a model and endpoint before live eval.');
  if (opts.models) {
    const report = await require('./matrix').runMatrix(
      {
        ...opts,
        models: opts.models.split(',').map((id) => id.trim()),
        setup: profile,
        threshold,
        taskTimeoutMs: deadline,
        maxRounds: rounds,
        maxOutputTokens,
      },
      { log },
    );
    log(
      JSON.stringify({
        report: path.join(path.resolve(opts.out), 'matrix-report.json'),
        ok: report.ok,
        passed: report.passed,
        total: report.total,
      }),
    );
    if (!report.ok) process.exitCode = 1;
    return report;
  }
  // Validate the complete request policy before creating files or spending tokens.
  require('../model-runtime').createModelRuntime({
    primary: profile,
    maxCost: opts.maxCost,
    maxOutputTokens,
  });
  const destination = path.resolve(opts.out);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.mkdir(destination, { recursive: false });
  let server, currentTask, step;
  try {
    if (opts.fixture) {
      model = 'deterministic-protocol-fixture';
      server = http.createServer(async (req, res) => {
        for await (const _chunk of req) {
          /* drain request */
        }
        const calls = currentTask.steps[step++],
          message = calls
            ? { tool_calls: calls }
            : { content: 'Fixture task complete; acceptance is checked independently.' };
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            choices: [{ message, finish_reason: calls ? 'tool_calls' : 'stop' }],
            usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
          }),
        );
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    }
    const source = path.resolve(__dirname, '../..'),
      hash = createHash('sha256');
    const sourceFiles = [
      'cli/index.js',
      'cli/agent-policy.js',
      'cli/model-runtime.js',
      'cli/tool-hooks.js',
      'cli/task-input.js',
      'cli/execution-environment.js',
      'cli/windows-job.ps1',
      'cli/language-tools.js',
      'cli/lsp-client.js',
      'src/runtime-settings.js',
      'src/reasoning.js',
      'src/services/agent-core.js',
      'src/services/agent-workflow.js',
      'src/services/core-tools.js',
      'src/services/file-mutation.js',
      'src/services/file-diagnostics.js',
      'src/services/diagnostics-worker.js',
      'src/services/providers.js',
      'src/services/llm-protocols.js',
      'src/services/coding-context.js',
      'src/services/search-worker.js',
      'src/services/commands.js',
      'cli/eval/index.js',
      'cli/eval/report.js',
      'cli/eval/tasks.js',
      'cli/eval/matrix.js',
    ];
    for (const file of sourceFiles)
      hash.update(file).update(await fs.readFile(path.join(source, file)));
    const results = [];
    for (const task of selected) {
      currentTask = task;
      step = 0;
      const root = path.join(destination, task.id),
        project = path.join(root, 'project'),
        home = path.join(root, 'home');
      await fs.mkdir(project, { recursive: true });
      await fs.mkdir(home);
      await task.seed(project);
      await fs.writeFile(
        path.join(project, 'AGENTS.md'),
        'This is a bounded coding evaluation. Work only on the requested files. Use real tool results, preserve provided checks and verify the requested behavior. No network or dependencies are needed.',
      );
      await fs.writeFile(
        path.join(home, 'config.json'),
        JSON.stringify({
          modelId: model,
          baseUrl,
          apiFormat: format,
          contextWindow: profile.contextWindow || 32768,
          pricing: profile.pricing,
          ...effort,
          runtime: { retries: 1, autoDiagnostics: true },
          maxOutputTokens,
        }),
      );
      const started = Date.now(),
        args = [
          path.join(source, 'cli/index.js'),
          '--trust-project',
          '--stream-json',
          '-C',
          project,
          '--task-timeout-ms',
          String(deadline),
          '--max-output-tokens',
          String(maxOutputTokens),
          ...(opts.maxCost ? ['--max-cost', opts.maxCost] : []),
          'run',
          '--approval',
          'auto',
          '--max-rounds',
          String(rounds),
          task.prompt,
        ];
      const execution = await new Promise((resolve) => {
        const child = spawn(process.execPath, args, {
          cwd: project,
          windowsHide: true,
          timeout: deadline + 15000,
          env: {
            ...process.env,
            ACHERNAR_CLI_HOME: home,
            ACHERNAR_MODEL: model,
            ACHERNAR_BASE_URL: baseUrl,
            ACHERNAR_API_FORMAT: opts.fixture ? 'openai-chat-completions' : format,
            ACHERNAR_API_KEY: key,
            ACHERNAR_NOTIFICATIONS: '0',
          },
        });
        let stdout = '',
          stderr = '',
          failure;
        child.stdout.on('data', (bytes) => {
          stdout += bytes;
        });
        child.stderr.on('data', (bytes) => {
          stderr += bytes;
        });
        child.on('error', (error) => {
          failure = error.message;
        });
        child.on('close', (code) => resolve({ code, stdout, stderr, error: failure }));
        child.stdin.end();
      });
      const rows = execution.stdout
        .trim()
        .split('\n')
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        });
      const events = rows.filter((row) => row.type === 'event').map((row) => row.event);
      const acceptance = await task.accept(project, events);
      const record = {
        id: task.id,
        passed: execution.code === 0 && acceptance.passed,
        acceptance,
        elapsedMs: Date.now() - started,
        model,
        endpoint: baseUrl,
        exitCode: execution.code,
        reasoningLevel: effort.reasoningLevel || null,
        maxOutputTokens,
        toolCalls: events.filter((event) => event.type === 'tool_start').length,
        ...executionMetrics(rows),
        error: rows.findLast((row) => row.type === 'error')?.error || execution.error || null,
      };
      await fs.writeFile(
        path.join(root, 'events.jsonl'),
        require('../session-export').redact(execution.stdout, { secrets: [key] }),
      );
      await fs.writeFile(path.join(root, 'result.json'), JSON.stringify(record, null, 2));
      results.push(record);
      log(
        JSON.stringify({
          task: task.id,
          passed: record.passed,
          model,
          elapsedMs: record.elapsedMs,
          error: record.error,
        }),
      );
    }
    const report = {
      ...evaluateReport(results, threshold),
      measuredAt: new Date().toISOString(),
      kind: opts.live ? 'live-model' : 'deterministic-fixture',
      note: opts.live
        ? 'Small fixed local coding suite; not a product ranking or general capability benchmark. Failures and timeouts count against the pass rate.'
        : 'Transport and acceptance regression only; not evidence of real model quality.',
      model,
      endpoint: baseUrl,
      reasoning: effort,
      maxOutputTokens,
      taskTimeoutMs: deadline,
      maxRounds: rounds,
      maxCostUsd: opts.maxCost != null ? Number(opts.maxCost) : null,
      sourceSha256: hash.digest('hex'),
      sourceFiles,
      node: process.version,
      platform: process.platform,
      results,
    };
    await fs.writeFile(path.join(destination, 'report.json'), JSON.stringify(report, null, 2));
    log(
      JSON.stringify({
        report: path.join(destination, 'report.json'),
        ...evaluateReport(results, threshold),
      }),
    );
    if (!report.ok) process.exitCode = 1;
    return report;
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { main, resolveEvalProfile };
