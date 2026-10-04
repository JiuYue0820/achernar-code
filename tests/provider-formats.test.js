const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { normalizeProvider, streamChat, testProvider } = require('../src/services/providers');
const { runAgent } = require('../src/services/agent');

async function server(handler) {
  const requests = [];
  const instance = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const record = { url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null };
    requests.push(record); handler(record, res, requests.length);
  });
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  return { requests, baseUrl: `http://127.0.0.1:${instance.address().port}/v1`, close: () => { instance.closeAllConnections(); return new Promise(resolve => instance.close(resolve)); } };
}
const sse = (res, events) => { res.setHeader('Content-Type', 'text/event-stream'); res.end(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('')); };
const definition = { type: 'function', function: { name: 'files', description: 'Read file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } };
const image = { type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } };
const formats = ['openai-responses', 'anthropic-messages', 'gemini'];

function output(format, tool) {
  if (format === 'openai-responses') return tool ? [
    { type: 'response.reasoning_summary_text.delta', delta: 'Plan' },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'r1', summary: [{ type: 'summary_text', text: 'Plan' }], encrypted_content: 'signature' } },
    { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', id: 'fc1', call_id: 'call1', name: 'files', arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"path":' },
    { type: 'response.function_call_arguments.delta', output_index: 1, delta: '"a.txt"}' },
    { type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', id: 'fc1', call_id: 'call1', name: 'files', arguments: '{"path":"a.txt"}' } },
    { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 12, output_tokens: 5 } } },
  ] : [{ type: 'response.output_text.delta', delta: 'Done' }, { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 12, output_tokens: 5 } } }];
  if (format === 'anthropic-messages') return [
    { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } },
    ...(tool ? [
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Plan' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signature' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call1', name: 'files', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"a.txt"}' } },
    ] : [{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done' } }]),
    { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 5 } }, { type: 'message_stop' },
  ];
  return [{ candidates: [{ content: { role: 'model', parts: tool ? [{ thought: true, text: 'Plan' }, { functionCall: { name: 'files', args: { path: 'a.txt' } }, thoughtSignature: 'signature' }] : [{ text: 'Done' }], }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5, totalTokenCount: 17 } }];
}

for (const format of formats) {
  test(format + ' streams reasoning and tools and preserves native context on the next round', async () => {
    const mock = await server((_req, res, count) => sse(res, output(format, count === 1)));
    try {
      const provider = { ...normalizeProvider({ name: 'Test', modelId: 'model', apiFormat: format, baseUrl: mock.baseUrl, vision: true }), apiKey: 'test-key' };
      const events = [], executed = [];
      const result = await runAgent({ provider, messages: [{ role: 'user', content: 'Read the file' }], signal: new AbortController().signal,
        emit: event => events.push(event), tools: { definitions: [definition], execute: async (name, args) => { executed.push({ name, args }); return { text: 'ok' }; } }, maxRounds: 3 });
      assert.equal(result.content, 'Done'); assert.equal(result.reasoning, 'Plan');
      assert.deepEqual(executed, [{ name: 'files', args: { path: 'a.txt' } }]); assert.equal(mock.requests.length, 2);
      const [first, second] = mock.requests;
      assert.equal(result.usage.prompt_tokens, 12); assert.equal(result.usage.completion_tokens, 5);
      if (format === 'openai-responses') {
        assert.equal(first.url, '/v1/responses'); assert.equal(first.headers.authorization, 'Bearer test-key');
        assert.equal(first.body.tools[0].name, 'files'); assert.equal(first.body.store, false);
        assert.ok(second.body.input.some(item => item.encrypted_content === 'signature'));
        // The CLI host appends <run_state> after tool results, so the output is not necessarily last.
        assert.ok(second.body.input.some(item => item.type === 'function_call_output'));
      } else if (format === 'anthropic-messages') {
        assert.equal(first.url, '/v1/messages'); assert.equal(first.headers['x-api-key'], 'test-key'); assert.equal(first.headers.authorization, undefined);
        assert.equal(first.headers['anthropic-version'], '2023-06-01'); assert.equal(first.body.tools[0].input_schema.type, 'object');
        assert.equal(second.body.messages.at(-2).content[0].signature, 'signature');
        assert.equal(second.body.messages.at(-1).content[0].type, 'tool_result');
      } else {
        assert.equal(first.url, '/v1/models/model:streamGenerateContent?alt=sse'); assert.equal(first.headers['x-goog-api-key'], 'test-key');
        assert.equal(first.body.tools[0].functionDeclarations[0].name, 'files');
        assert.equal(second.body.contents.at(-2).parts[1].thoughtSignature, 'signature');
        assert.equal(second.body.contents.at(-1).parts[0].functionResponse.name, 'files');
      }
      assert.ok(events.some(event => event.type === 'tool_start'));
    } finally { await mock.close(); }
  });
  test(format + ' maps image input and rejects truncated or error streams', async () => {
    let mode = 'image';
    const mock = await server((_req, res) => sse(res, mode === 'error' ? [{ error: { message: 'failed' } }] : mode === 'truncated' ? output(format, true).slice(0, -1) : output(format, false)));
    try {
      const provider = { apiFormat: format, baseUrl: mock.baseUrl, modelId: 'model' };
      await streamChat(provider, [{ role: 'system', content: 'System' }, { role: 'user', content: [{ type: 'text', text: 'Image' }, image] }], { signal: new AbortController().signal });
      const body = mock.requests[0].body;
      assert.match(JSON.stringify(body), format === 'openai-responses' ? /input_image/ : format === 'anthropic-messages' ? /base64/ : /inlineData/);
      mode = 'truncated'; await assert.rejects(streamChat(provider, [], { signal: new AbortController().signal }), /提前结束/);
      mode = 'error'; await assert.rejects(streamChat(provider, [], { signal: new AbortController().signal }));
    } finally { await mock.close(); }
  });
}

test('model discovery understands Gemini and Anthropic payloads', async () => {
  const mock = await server((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(req.headers['x-goog-api-key'] ? { models: [{ name: 'models/gemini-test', inputTokenLimit: 65536, supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }] } : { data: [{ id: 'claude-test' }] })); });
  try {
    for (const apiFormat of ['gemini', 'anthropic-messages']) {
      const result = await testProvider({ apiFormat, baseUrl: mock.baseUrl, apiKey: 'test' }); assert.equal(result.ok, true);
      assert.deepEqual(result.models, [apiFormat === 'gemini' ? 'gemini-test' : 'claude-test']);
    }
  } finally { await mock.close(); }
});
