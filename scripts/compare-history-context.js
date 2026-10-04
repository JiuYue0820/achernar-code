const fs = require('node:fs'), path = require('node:path');
const { runAgent, modelMessages } = require('../src/services/agent');
(async () => {
  const variant=process.argv[2];if(!['original','compact'].includes(variant))throw Error('Use original or compact');
  const root='D:/User/Desktop/Project/Test-CLI',source=path.join(root,'ui-generation-20260926/achernar/cli-home/sessions');
  const record=JSON.parse(fs.readFileSync(path.join(source,fs.readdirSync(source).find(f=>f.endsWith('.json'))),'utf8'));
  const output=path.join(root,'history-context-20260926',variant);if(fs.existsSync(output))throw Error('Evidence exists');fs.mkdirSync(output,{recursive:true});
  const messages=modelMessages(record.messages,{},variant==='compact'?'cli':'desktop');
  messages.push({role:'user',content:'Using only this saved conversation and historical execution record, summarize the completed deliverables and actual validation in at most 120 English words. Distinguish independent evaluator checks from your own checks. Do not claim fresh verification or execute anything. Do not repeat source code.'});
  fs.writeFileSync(path.join(output,'input.json'),JSON.stringify(messages,null,2));
  const events=[],started=Date.now();
  console.log(variant+' history request started');
  try {
    const result=await runAgent({provider:{modelId:'space-bunny-free',baseUrl:'https://opencode.ai/zen/v1',apiFormat:'openai-chat-completions',contextWindow:131072},messages,host:'cli',taskMode:'code',signal:AbortSignal.timeout(90000),emit:e=>events.push(e),maxRounds:2});
    fs.writeFileSync(path.join(output,'result.md'),result.finalContent);
    const metrics={variant,elapsedMs:Date.now()-started,inputCharacters:JSON.stringify(messages).length,totalUsage:result.totalUsage,finalChars:result.finalContent.length,completed:true};
    fs.writeFileSync(path.join(output,'metrics.json'),JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics));
  } catch(error){const metrics={variant,elapsedMs:Date.now()-started,completed:false,error:error.message};fs.writeFileSync(path.join(output,'metrics.json'),JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics));process.exitCode=1}
  finally{fs.writeFileSync(path.join(output,'events.jsonl'),events.map(e=>JSON.stringify(e)).join('\n'))}
})().catch(e=>{console.error(e);process.exitCode=1});
