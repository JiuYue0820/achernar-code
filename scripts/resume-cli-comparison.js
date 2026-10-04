const fs = require('node:fs'), path = require('node:path');
const { cases, child } = require('./compare-cli');
(async () => {
  const variant = process.argv[2], task = process.argv[3];
  if (!['opencode', 'achernar-after'].includes(variant) || !cases[task]) throw Error('Provide variant and task');
  const evidence = path.join('D:/User/Desktop/Project/Test-CLI/validated-20260926', variant, task), work = path.join(evidence, 'project');
  const env = { ...process.env, ACHERNAR_NOTIFICATIONS: '0', ACHERNAR_CLI_HOME: path.join(evidence, 'cli-home'), ACHERNAR_MODEL: 'space-bunny-free', ACHERNAR_BASE_URL: 'https://opencode.ai/zen/v1', ACHERNAR_API_FORMAT: 'openai-chat-completions', ACHERNAR_API_KEY: '', OPENAI_API_KEY: '', OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: 'opencode/space-bunny-free', small_model: 'opencode/space-bunny-free', share: 'disabled', autoupdate: false }) };
  const prompt = 'Continue the original task after a timed interruption. Inspect existing files and completed operations before acting; do not redo them unnecessarily. Complete all originally requested deliverables, run the relevant tests, fix failures, and give a concise final result with actual verification.';
  let id, args, exe;
  if (variant === 'opencode') {
    id = fs.readFileSync(path.join(evidence, 'run.stdout'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).find(e => e.sessionID).sessionID;
    exe = path.join(process.env.APPDATA, 'npm/node_modules/opencode-ai/bin/opencode.exe'); args = ['run', '--pure', '--auto', '--model', 'opencode/space-bunny-free', '--format', 'json', '--session', id, prompt];
  } else {
    const dir = path.join(env.ACHERNAR_CLI_HOME, 'sessions'); id = fs.readdirSync(dir).find(f => f.endsWith('.json')).slice(0, -5);
    // The previous benchmark process was killed by its recorded timeout. This
    // script is run only after confirming it has exited; remove that stale lock.
    const lock = path.join(dir, id + '.json.lock'); if (fs.existsSync(lock)) fs.unlinkSync(lock);
    exe = process.execPath; args = [path.resolve(__dirname, '../cli/index.js'), '--stream-json', 'resume', '--approval', 'auto', '--max-rounds', '32', id, prompt];
  }
  console.log('Resuming ' + variant + '/' + task);
  const run = await child(exe, args, work, env, path.join(evidence, 'continuation'), 240000);
  const tests = await child(process.execPath, ['--test'], work, env, path.join(evidence, 'tests-after-continuation'), 30000);
  const acceptance = await child(process.execPath, ['-e', cases[task].validate], work, env, path.join(evidence, 'acceptance-after-continuation'), 30000);
  const events = run.stdout.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return {}; } });
  const final = variant === 'opencode' ? events.filter(e => e.type === 'text').map(e => e.part.text).join('\n\n') : events.findLast(e => e.type === 'result')?.data.finalContent || '';
  fs.writeFileSync(path.join(evidence, 'final-after-continuation.md'), final);
  const testCount = Number(tests.stdout.match(/(?:ℹ tests |# tests )(\d+)/)?.[1] || 0);
  const metrics = { variant, task, sessionId: id, additionalMs: run.elapsedMs, exitCode: run.code, timedOut: run.timedOut, testCount, testsPassed: tests.code === 0 && testCount > 0, acceptancePassed: acceptance.code === 0, finalChars: final.length, toolCalls: variant === 'opencode' ? events.filter(e => e.type === 'tool_use').length : events.filter(e => e.event?.type === 'tool_result').length };
  fs.writeFileSync(path.join(evidence, 'continuation-metrics.json'), JSON.stringify(metrics, null, 2)); console.log(JSON.stringify(metrics));
})().catch(e=>{console.error(e);process.exitCode=1});
