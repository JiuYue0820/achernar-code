// Isolated local model fixture for real CMD/PowerShell terminal verification.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-tui-pty-')), home = path.join(root, 'home'), project = path.join(root, 'project');
fs.mkdirSync(home); fs.mkdirSync(project);
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/v1/models') { res.end(JSON.stringify({ data: [{ id: 'fixture-coder', context_window: 128000 }] })); return; }
  let text = ''; for await (const bytes of req) text += bytes;
  const body = JSON.parse(text), tools = body.messages.filter(m => m.role === 'tool');
  let message;
  if (!tools.length) message = { reasoning_content: 'Inspect the task, then create a small source file.', tool_calls: [call('write', 'files', { action: 'write', path: 'verified.js', content: 'module.exports = 42;\n' })] };
  else if (tools.length === 1) message = { tool_calls: [call('mcp', 'mcp', { action: 'call', serverId: 'plugins/achernar/achernar-json-tools/json-tools', tool: 'json_inspect', arguments: { json: '{"verified":true}', pointer: '/verified' } })] };
  else message = { content: 'Created verified.js and checked the result using the official JSON plugin.\n\nThe source file exports 42.' };
  fs.writeFileSync(path.join(root, 'requests.json'), JSON.stringify({ rounds: tools.length + 1, mode: body.messages[0]?.content.match(/Current live execution mode:[^\n]+/)?.[0], lastTool: tools.at(-1)?.content }, null, 2));
  res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1000 + tools.length * 200, completion_tokens: 80, total_tokens: 1080 + tools.length * 200 } }));
});
server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ modelId: 'fixture-coder', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiFormat: 'openai-chat-completions', contextWindow: 128000 }));
  const result = { root, home, project }; fs.mkdirSync(path.resolve(__dirname, '../../outputs'), { recursive: true }); fs.writeFileSync(path.resolve(__dirname, '../../outputs/cli-tui-pty.json'), JSON.stringify(result)); console.log(JSON.stringify(result));
});
