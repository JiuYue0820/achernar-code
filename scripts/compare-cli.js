// Real, synthetic, same-model comparison. Never points agents at Achernar source.
const fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const root = 'D:/User/Desktop/Project/Test-CLI';
const model = 'space-bunny-free';
const cases = {
  repair: {
    files: {
      'package.json': JSON.stringify({ name: 'summary-fixture', private: true, scripts: { test: 'node --test' } }, null, 2),
      'summary.js': "function summarize(items) { const groups = {}; for (const item of items) { groups[item.category] = (groups[item.category] || 0) + item.amount; } return Object.entries(groups).map(([category, total]) => ({ category, total })).sort(); }\nmodule.exports = { summarize };\n",
      'summary.test.js': "const {test}=require('node:test'),assert=require('node:assert/strict');const {summarize}=require('./summary');test('basic',()=>assert.deepEqual(summarize([{category:'food',amount:2}]),[{category:'food',total:2}]));\n",
      'USER-NOTES.txt': 'User-owned note. Preserve this exact text.\n',
    },
    prompt: 'Fix summarize(items) in summary.js. It must skip invalid records (null/nonobject, category not a nonempty trimmed string, amount not a finite number), sum safely even for category __proto__, round final totals to 2 decimals, and return category objects sorted alphabetically by category (case sensitive). Do not mutate input. Add regression tests including empty input, duplicate categories, invalid records, decimals and prototype-like names. Keep USER-NOTES.txt unchanged. Run tests. Finish with a concise account of changes and actual verification. Use no external dependencies or network.',
    validate: "const assert=require('node:assert/strict'),fs=require('node:fs');const {summarize}=require('./summary');const input=[{category:'z',amount:.1},{category:'z',amount:.2},{category:'__proto__',amount:3},null,{}, {category:'',amount:1},{category:'x',amount:'2'},{category:'a',amount:Infinity},{category:'a',amount:-1}];const copy=JSON.stringify(input);assert.deepEqual(summarize(input),[{category:'__proto__',total:3},{category:'a',total:-1},{category:'z',total:.3}]);assert.equal(JSON.stringify(input),copy);assert.deepEqual(summarize([]),[]);assert.equal(fs.readFileSync('USER-NOTES.txt','utf8'),'User-owned note. Preserve this exact text.\\n');console.log('External acceptance passed');",
  },
  feature: {
    files: { 'package.json': JSON.stringify({ name: 'csv-fixture', private: true, scripts: { test: 'node --test' } }), 'README.md': '# CSV export utility\n', 'USER-NOTES.txt': 'User-owned note. Preserve this exact text.\n' },
    prompt: 'Implement a dependency-free CommonJS CSV utility. csv.js exports toCsv(records,columns); columns is a list of key strings and determines header/order; records is an array of objects. Missing/null values become empty, quotes double inside quoted fields, and fields containing commas, quotes, CR or LF are quoted. Use CRLF rows and end with CRLF. Empty records still produce the header. Throw TypeError for non-array inputs or any non-string column. Add export.js CLI accepting input.json output.csv comma-separated columns, with nonzero exit and useful stderr on invalid JSON or arguments. Add node:test tests, update README with usage, run tests and exercise the CLI on a small sample. Keep USER-NOTES.txt unchanged. Use no external dependencies or network. Conclude with changes and actual verification.',
    validate: "const assert=require('node:assert/strict'),fs=require('node:fs'),{spawnSync}=require('node:child_process');const {toCsv}=require('./csv');assert.equal(toCsv([{name:'A,B',note:'say \"hi\"'},{name:'x\\ny',note:null}],['name','note']),'name,note\\r\\n\"A,B\",\"say \"\"hi\"\"\"\\r\\n\"x\\ny\",\\r\\n');assert.equal(toCsv([],['a']),'a\\r\\n');assert.throws(()=>toCsv({},[]),TypeError);assert.throws(()=>toCsv([],['a',3]),TypeError);const r=spawnSync(process.execPath,['export.js'],{encoding:'utf8'});assert.notEqual(r.status,0);assert.ok(r.stderr.trim());assert.equal(fs.readFileSync('USER-NOTES.txt','utf8'),'User-owned note. Preserve this exact text.\\n');console.log('External acceptance passed');",
  },
};
async function child(exe, args, cwd, env, output, limit = 240000) {
  const started = Date.now();
  return new Promise(resolve => {
    const p = spawn(exe, args, { cwd, env, windowsHide: true }); let stdout = '', stderr = '', timedOut = false;
    p.stdin.end(); // OpenCode reads piped stdin before starting a run.
    const timer = setTimeout(() => { timedOut = true; p.kill(); }, limit);
    p.stdout.on('data', b => stdout += b); p.stderr.on('data', b => stderr += b);
    p.on('error', e => stderr += e.message);
    p.on('close', code => { clearTimeout(timer); fs.writeFileSync(output + '.stdout', stdout); fs.writeFileSync(output + '.stderr', stderr); resolve({ code, timedOut, elapsedMs: Date.now() - started, stdout, stderr }); });
  });
}
async function main() {
  const variant = process.argv[2], runName = process.argv[3];
  if (!['opencode', 'achernar-before', 'achernar-after'].includes(variant) || !/^[\w-]+$/.test(runName || '')) throw Error('Usage: node scripts/compare-cli.js opencode|achernar-before|achernar-after run-id');
  const runRoot = path.join(root, runName, variant); fs.mkdirSync(runRoot, { recursive: true });
  let cliPath = path.resolve(__dirname, '../cli/index.js');
  if (variant === 'achernar-before') {
    const snapshot = path.join(runRoot, 'cli-snapshot'), zipPath = path.join(runRoot, 'cli-before.zip');
    await require('../src/services/cli-package').buildCliPackage(path.resolve(__dirname, '..'), zipPath);
    const zip = await require('jszip').loadAsync(fs.readFileSync(zipPath));
    for (const entry of Object.values(zip.files)) if (!entry.dir) { const file = path.join(snapshot, entry.name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, await entry.async('nodebuffer')); }
    fs.symlinkSync(path.resolve(__dirname, '../node_modules'), path.join(snapshot, 'node_modules'), 'junction');
    cliPath = path.join(snapshot, 'cli/index.js'); console.log('Baseline snapshot saved: ' + snapshot);
  }
  const results = [];
  for (const [name, task] of Object.entries(cases)) {
    const work = path.join(runRoot, name, 'project'), evidence = path.join(runRoot, name); if (fs.existsSync(work)) throw Error('Refusing to overwrite an existing benchmark'); fs.mkdirSync(work, { recursive: true });
    for (const [file, value] of Object.entries(task.files)) fs.writeFileSync(path.join(work, file), value);
    fs.writeFileSync(path.join(work, 'AGENTS.md'), 'Use Node.js built-in modules only. This is a small CommonJS project. Preserve user notes. Read relevant files, implement the requested behavior, run node --test, inspect failures and fix them before completing. Shell on this machine is Windows PowerShell.\n');
    fs.writeFileSync(path.join(evidence, 'task.txt'), task.prompt);
    const env = { ...process.env, ACHERNAR_NOTIFICATIONS: '0', ACHERNAR_CLI_HOME: path.join(evidence, 'cli-home'), ACHERNAR_MODEL: model, ACHERNAR_BASE_URL: 'https://opencode.ai/zen/v1', ACHERNAR_API_FORMAT: 'openai-chat-completions', ACHERNAR_API_KEY: '', OPENAI_API_KEY: '', OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: 'opencode/' + model, small_model: 'opencode/' + model, share: 'disabled', autoupdate: false }) };
    const home = env.ACHERNAR_CLI_HOME; fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ modelId: model, baseUrl: env.ACHERNAR_BASE_URL, contextWindow: 131072, apiFormat: 'openai-chat-completions' }));
    const exe = variant === 'opencode' ? path.join(process.env.APPDATA, 'npm/node_modules/opencode-ai/bin/opencode.exe') : process.execPath;
    const args = variant === 'opencode' ? ['run', '--pure', '--auto', '--model', 'opencode/' + model, '--format', 'json', task.prompt] : [cliPath, '--json', 'run', '--approval', 'auto', '--max-rounds', '32', task.prompt];
    console.log(`${variant}/${name} started`);
    const result = await child(exe, args, work, env, path.join(evidence, 'run'));
    const tests = await child(process.execPath, ['--test'], work, env, path.join(evidence, 'tests'), 30000);
    const acceptance = await child(process.execPath, ['-e', task.validate], work, env, path.join(evidence, 'acceptance'), 30000);
    let final = '', tokens = null, toolCalls = 0, cost = null;
    try {
      if (variant === 'opencode') { const events = result.stdout.trim().split('\n').map(l => JSON.parse(l)); final = events.filter(e => e.type === 'text').map(e => e.part.text).join('\n\n'); toolCalls = events.filter(e => e.type === 'tool_use').length; const steps = events.filter(e => e.type === 'step_finish'); tokens = steps.reduce((n,e)=>n+(e.part.tokens?.total || 0),0); cost = steps.reduce((n,e)=>n+(e.part.cost || 0),0); }
      else { const data = JSON.parse(result.stdout).data; final = data?.finalContent || data?.content || ''; toolCalls = data?.events.filter(e => e.type === 'tool_result').length || 0; tokens = data?.totalUsage?.total_tokens ?? null; }
    } catch {}
    fs.writeFileSync(path.join(evidence, 'final.md'), final);
    const testCount = Number(tests.stdout.match(/(?:ℹ tests |# tests )(\d+)/)?.[1] || 0);
    const record = { variant, task: name, model, elapsedMs: result.elapsedMs, exitCode: result.code, timedOut: result.timedOut, testsPassed: tests.code === 0 && testCount > 0, testCount, acceptancePassed: acceptance.code === 0, toolCalls, reportedTokens: tokens, cost, finalChars: final.length };
    fs.writeFileSync(path.join(evidence, 'metrics.json'), JSON.stringify(record, null, 2)); results.push(record); console.log(JSON.stringify(record));
  }
  fs.writeFileSync(path.join(runRoot, 'results.json'), JSON.stringify(results, null, 2));
}
if (require.main === module) main().catch(e=>{console.error(e);process.exitCode=1});
module.exports = { cases, child };
