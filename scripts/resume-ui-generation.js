const fs = require('node:fs'), path = require('node:path');
const { child } = require('./compare-cli');
(async () => {
  const variant = process.argv[2]; if (!['opencode', 'achernar'].includes(variant)) throw Error('Use opencode or achernar');
  const evidence = path.join('D:/User/Desktop/Project/Test-CLI/ui-generation-20260926', variant), work = path.join(evidence, 'project');
  if (fs.existsSync(path.join(evidence, 'continuation.stdout'))) throw Error('Continuation evidence already exists');
  fs.copyFileSync(path.join(work, 'index.html'), path.join(evidence, 'index-before-continuation.html'));
  fs.copyFileSync(path.join(evidence, 'browser-acceptance.json'), path.join(work, 'INDEPENDENT-VALIDATION.json'));
  const prompt = 'Continue the original reading-list task. The evaluator independently browser-tested the generated page; read INDEPENDENT-VALIDATION.json for actual results. Preserve that evidence and USER-NOTES.txt. Complete missing deliverables including README.md; report honestly which checks the evaluator performed versus your own. Do not build or repair a custom CDP harness, do not start a browser or server, and do not stop any processes. Use bounded source/syntax checks if needed, fix actual failures only, then give a concise final result. No dependencies or network.';
  fs.writeFileSync(path.join(evidence, 'continuation-task.txt'), prompt);
  const env = { ...process.env, ACHERNAR_NOTIFICATIONS: '0', ACHERNAR_CLI_HOME: path.join(evidence, 'cli-home'), ACHERNAR_MODEL: 'space-bunny-free', ACHERNAR_BASE_URL: 'https://opencode.ai/zen/v1', ACHERNAR_API_FORMAT: 'openai-chat-completions', ACHERNAR_API_KEY: '', OPENAI_API_KEY: '', OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: 'opencode/space-bunny-free', small_model: 'opencode/space-bunny-free', share: 'disabled', autoupdate: false }) };
  let id, exe, args;
  if (variant === 'opencode') {
    id = fs.readFileSync(path.join(evidence, 'run.stdout'), 'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)).find(e=>e.sessionID).sessionID;
    exe = path.join(process.env.APPDATA, 'npm/node_modules/opencode-ai/bin/opencode.exe'); args = ['run','--pure','--auto','--model','opencode/space-bunny-free','--format','json','--session',id,prompt];
  } else {
    const dir=path.join(env.ACHERNAR_CLI_HOME,'sessions');id=fs.readdirSync(dir).find(f=>f.endsWith('.json')).slice(0,-5);
    exe=process.execPath;args=[path.resolve(__dirname,'../cli/index.js'),'--stream-json','resume','--approval','auto','--max-rounds','16',id,prompt];
  }
  console.log(variant+' continuation started (120s limit)');
  const run=await child(exe,args,work,env,path.join(evidence,'continuation'),120000);
  const events=run.stdout.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return {}}});
  const data=events.findLast(e=>e.type==='result')?.data;
  const final=variant==='opencode'?events.filter(e=>e.type==='text').map(e=>e.part.text).join('\n\n'):data?.finalContent||'';
  fs.writeFileSync(path.join(evidence,'final-after-continuation.md'),final);
  const metrics={variant,additionalMs:run.elapsedMs,exitCode:run.code,timedOut:run.timedOut,hasReadme:fs.existsSync(path.join(work,'README.md')),finalChars:final.length,toolCalls:events.filter(e=>e.type==='tool_use'||e.event?.type==='tool_result').length,reportedTokens:data?.totalUsage?.total_tokens??null};
  fs.writeFileSync(path.join(evidence,'continuation-metrics.json'),JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics));
})().catch(e=>{console.error(e);process.exitCode=1});
