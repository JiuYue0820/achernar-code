const { randomUUID } = require('node:crypto');
const reasoning = require('../reasoning');

const parts = message => typeof message.content === 'string' ? (message.content ? [{ type: 'text', text: message.content }] : []) : message.content || [];
const systemText = messages => messages.filter(m => ['system', 'developer'].includes(m.role)).flatMap(parts).map(p => p.text || '').join('\n');
const conversation = messages => messages.filter(m => !['system', 'developer'].includes(m.role));
const native = (message, format) => message.providerResponse?.format === format ? message.providerResponse.content : null;
function imageData(url) {
  const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(url || '');
  if (!match) throw new Error('此接口的图片输入需要有效的 base64 图片');
  return { mime: match[1], data: match[2] };
}
function grouped(messages) {
  const result = [];
  for (const message of messages) {
    if (!message.content.length) continue;
    if (result.at(-1)?.role === message.role) result.at(-1).content.push(...message.content);
    else result.push(message);
  }
  return result;
}
function accumulator(options) {
  const result = { content: '', reasoning: '', toolCalls: [], finishReason: 'stop' };
  return {
    result,
    text(value) { if (value) { result.content += value; options.onToken(value); } },
    thought(value) { if (value) { result.reasoning += value; options.onReasoning(value); } },
    call(call) {
      if (call.function.arguments.length > 200000 || result.toolCalls.length >= 32 && !result.toolCalls.includes(call)) throw new Error('模型工具调用超过大小限制');
      if (!result.toolCalls.includes(call)) result.toolCalls.push(call);
      options.onToolDelta(call);
    },
    usage(value) { if (value) options.onUsage(value); },
  };
}
const toolCall = (id, name, args = '') => ({ id, type: 'function', function: { name, arguments: args } });
const commonUsage = usage => ({ ...usage, prompt_tokens: usage.input_tokens || 0, completion_tokens: usage.output_tokens || 0, total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0) });

async function responses(provider, messages, options, { request, readStream }) {
  const a = accumulator(options), items = new Map(), calls = new Map();
  const input = conversation(messages).flatMap(message => {
    const original = native(message, 'openai-responses'); if (original) return original;
    if (message.role === 'tool') return [{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }];
    const content = parts(message).map(part => part.type === 'image_url'
      ? { type: 'input_image', image_url: part.image_url.url, detail: 'auto' }
      : { type: message.role === 'assistant' ? 'output_text' : 'input_text', text: part.text });
    return [...(content.length ? [{ role: message.role, content }] : []), ...(message.tool_calls || []).map(call => ({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments }))];
  });
  const body = { model: provider.modelId, instructions: systemText(messages), input, stream: true, store: false, include: ['reasoning.encrypted_content'] };
  if (options.maxTokens) body.max_output_tokens = options.maxTokens;
  if (options.tools?.length) body.tools = options.tools.map(({ function: fn }) => ({ type: 'function', ...fn, strict: false }));
  const effort = reasoning.normalize(provider).reasoningLevel;
  if (effort) body.reasoning = { effort, summary: 'auto' };
  const response = await request(provider, 'responses', { method: 'POST', signal: options.signal, body: JSON.stringify(body) });
  let completed = false;
  const finish = data => {
    if (data.error || data.status === 'failed') throw new Error('Responses 接口返回错误');
    completed = true;
    if (data.status === 'incomplete') {
      if (data.incomplete_details?.reason !== 'max_output_tokens') throw new Error('Responses 响应未完成');
      a.result.finishReason = 'length';
    }
    if (data.usage) a.usage(commonUsage(data.usage));
  };
  if (response.headers.get('content-type')?.includes('application/json')) {
    const data = await response.json(); finish(data);
    for (const [index, item] of (data.output || []).entries()) {
      items.set(index, item);
      if (item.type === 'message') for (const part of item.content || []) a.text(part.text || part.refusal);
      if (item.type === 'reasoning') for (const part of item.summary || []) a.thought(part.text);
      if (item.type === 'function_call') a.call(toolCall(item.call_id, item.name, item.arguments));
    }
  } else await readStream(response.body, event => {
    if (event.error || event.type === 'error' || event.type === 'response.failed') throw new Error('Responses 流式响应返回错误');
    if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') a.text(event.delta);
    if (event.type === 'response.reasoning_summary_text.delta') a.thought(event.delta);
    if (['response.output_item.added', 'response.output_item.done'].includes(event.type)) {
      items.set(event.output_index, event.item);
      if (event.item.type === 'function_call') {
        const call = calls.get(event.output_index) || toolCall(event.item.call_id, event.item.name);
        if (event.item.arguments) call.function.arguments = event.item.arguments;
        calls.set(event.output_index, call); a.call(call);
      }
    }
    if (event.type === 'response.function_call_arguments.delta') {
      const call = calls.get(event.output_index); if (!call) throw new Error('工具调用缺少起始事件');
      call.function.arguments += event.delta; a.call(call);
    }
    if (['response.completed', 'response.incomplete'].includes(event.type)) finish(event.response);
  });
  if (!completed) throw new Error('Responses 连接提前结束，请重试');
  a.result.providerResponse = { format: 'openai-responses', content: [...items.entries()].sort(([x], [y]) => x - y).map(([, item]) => item) };
  return a.result;
}

async function anthropic(provider, messages, options, { request, readStream }) {
  const a = accumulator(options), blocks = new Map(), calls = new Map();
  const input = grouped(conversation(messages).map(message => {
    if (message.role === 'tool') return { role: 'user', content: [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: message.content }] };
    const original = native(message, 'anthropic-messages');
    const content = original ? structuredClone(original) : [...parts(message).map(part => {
      if (part.type !== 'image_url') return { type: 'text', text: part.text };
      const image = imageData(part.image_url.url); return { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data } };
    }), ...(message.tool_calls || []).map(call => ({ type: 'tool_use', id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments || '{}') }))];
    return { role: message.role, content };
  }));
  const body = { model: provider.modelId, system: systemText(messages), messages: input, stream: true, max_tokens: options.maxTokens || 8192 };
  if (options.tools?.length) body.tools = options.tools.map(({ function: fn }) => ({ name: fn.name, description: fn.description, input_schema: fn.parameters }));
  const effort = reasoning.normalize(provider).reasoningLevel;
  if (effort && effort !== 'none') {
    const budget = { minimal: 1024, low: 1024, medium: 4096, high: 8192, xhigh: 16384, max: 16384 }[effort];
    if (!budget) throw new Error('Anthropic 推理档位不受支持，请选择 low、medium 或 high');
    if (!options.maxTokens) body.max_tokens = Math.max(8192, budget + 4096);
    if (body.max_tokens <= 1024) throw new Error('启用 Anthropic 思考时输出上限需大于 1024');
    body.thinking = { type: 'enabled', budget_tokens: Math.min(budget, body.max_tokens - 1) };
  }
  const response = await request(provider, 'messages', { method: 'POST', signal: options.signal, body: JSON.stringify(body) });
  let complete = false, usage = {};
  const reportUsage = value => { if (value) { for (const [key, amount] of Object.entries(value)) if (amount != null) usage[key] = amount; a.usage(commonUsage({ ...usage, input_tokens: (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) })); } };
  const stop = reason => { a.result.finishReason = reason === 'max_tokens' ? 'length' : reason === 'tool_use' ? 'tool_calls' : 'stop'; };
  const start = (index, block) => {
    blocks.set(index, structuredClone(block));
    if (block.type === 'text') a.text(block.text);
    if (block.type === 'thinking') a.thought(block.thinking);
    if (block.type === 'tool_use') { const call = toolCall(block.id, block.name, Object.keys(block.input || {}).length ? JSON.stringify(block.input) : ''); calls.set(index, call); a.call(call); }
  };
  if (response.headers.get('content-type')?.includes('application/json')) {
    const data = await response.json(); if (data.error) throw new Error('Anthropic 接口返回错误');
    (data.content || []).forEach((block, index) => start(index, block)); reportUsage(data.usage); stop(data.stop_reason); complete = true;
  } else await readStream(response.body, event => {
    if (event.type === 'error' || event.error) throw new Error('Anthropic 流式响应返回错误');
    if (event.type === 'message_start') reportUsage(event.message?.usage);
    if (event.type === 'content_block_start') start(event.index, event.content_block);
    if (event.type === 'content_block_delta') {
      const block = blocks.get(event.index), delta = event.delta;
      if (!block) throw new Error('内容块缺少起始事件');
      if (delta.type === 'text_delta') { block.text += delta.text; a.text(delta.text); }
      if (delta.type === 'thinking_delta') { block.thinking += delta.thinking; a.thought(delta.thinking); }
      if (delta.type === 'signature_delta') block.signature = (block.signature || '') + delta.signature;
      if (delta.type === 'input_json_delta') { const call = calls.get(event.index); call.function.arguments += delta.partial_json; a.call(call); }
    }
    if (event.type === 'message_delta') { reportUsage(event.usage); stop(event.delta?.stop_reason); }
    if (event.type === 'message_stop') complete = true;
  });
  if (!complete) throw new Error('Anthropic 连接提前结束，请重试');
  for (const [index, call] of calls) { call.function.arguments ||= '{}'; blocks.get(index).input = JSON.parse(call.function.arguments); }
  a.result.providerResponse = { format: 'anthropic-messages', content: [...blocks.values()] };
  return a.result;
}

async function gemini(provider, messages, options, { request, readStream }) {
  const a = accumulator(options), output = [], names = new Map();
  const input = grouped(conversation(messages).map(message => {
    for (const call of message.tool_calls || []) names.set(call.id, { name: call.function.name, id: call.providerId });
    if (message.role === 'tool') return { role: 'user', content: [{ functionResponse: { ...names.get(message.tool_call_id), response: { output: message.content } } }] };
    const original = native(message, 'gemini');
    const content = original ? structuredClone(original) : [...parts(message).map(part => {
      if (part.type !== 'image_url') return { text: part.text };
      const image = imageData(part.image_url.url); return { inlineData: { mimeType: image.mime, data: image.data } };
    }), ...(message.tool_calls || []).map(call => ({ functionCall: { id: call.id, name: call.function.name, args: JSON.parse(call.function.arguments || '{}') } }))];
    return { role: message.role === 'assistant' ? 'model' : 'user', content };
  })).map(({ role, content }) => ({ role, parts: content }));
  const body = { contents: input, systemInstruction: { parts: [{ text: systemText(messages) }] } };
  if (options.tools?.length) body.tools = [{ functionDeclarations: options.tools.map(({ function: fn }) => ({ name: fn.name, description: fn.description, parametersJsonSchema: fn.parameters })) }];
  if (options.maxTokens) body.generationConfig = { maxOutputTokens: options.maxTokens };
  const effort = reasoning.normalize(provider).reasoningLevel;
  if (effort) {
    const budget = { none: 0, minimal: 128, low: 1024, medium: 4096, high: 8192, xhigh: 16384, max: 24576 }[effort];
    if (budget == null) throw new Error('Gemini 推理档位不受支持，请选择 low、medium 或 high');
    const config = /^gemini-3/i.test(provider.modelId.replace(/^models\//, ''))
      ? { thinkingLevel: ['minimal', 'low', 'medium', 'high'].includes(effort) ? effort : effort === 'none' ? 'minimal' : 'high' }
      : { thinkingBudget: budget };
    body.generationConfig = { ...body.generationConfig, thinkingConfig: { ...config, includeThoughts: true } };
  }
  const route = 'models/' + encodeURIComponent(provider.modelId.replace(/^models\//, '')) + ':streamGenerateContent?alt=sse';
  const response = await request(provider, route, { method: 'POST', signal: options.signal, body: JSON.stringify(body) });
  let complete = false;
  const consume = data => {
    if (data.error || data.promptFeedback?.blockReason) throw new Error('Gemini 接口拒绝了此请求');
    const candidate = data.candidates?.[0];
    for (const original of candidate?.content?.parts || []) {
      const part = structuredClone(original);
      if (part.text) part.thought ? a.thought(part.text) : a.text(part.text);
      if (part.functionCall) {
        const call = toolCall(part.functionCall.id || 'gemini_' + randomUUID(), part.functionCall.name, JSON.stringify(part.functionCall.args || {}));
        if (part.functionCall.id) call.providerId = part.functionCall.id;
        a.call(call);
      }
      output.push(part);
    }
    if (data.usageMetadata) {
      const u = data.usageMetadata;
      a.usage({ prompt_tokens: u.promptTokenCount || 0, completion_tokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), total_tokens: u.totalTokenCount || 0 });
    }
    if (candidate?.finishReason) {
      complete = true;
      if (!['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) throw new Error('Gemini 输出未完成：' + candidate.finishReason);
      a.result.finishReason = candidate.finishReason === 'MAX_TOKENS' ? 'length' : 'stop';
    }
  };
  if (response.headers.get('content-type')?.includes('application/json')) { const data = await response.json(); (Array.isArray(data) ? data : [data]).forEach(consume); }
  else await readStream(response.body, consume);
  if (!complete) throw new Error('Gemini 连接提前结束，请重试');
  a.result.providerResponse = { format: 'gemini', content: output };
  return a.result;
}

async function streamProtocol(provider, messages, options, transport) {
  const adapter = { 'openai-responses': responses, 'anthropic-messages': anthropic, gemini }[provider.apiFormat];
  if (!adapter) throw new Error('不支持此接口格式');
  const result = await adapter(provider, messages, options, transport);
  // Never execute a partial tool request after output truncation.
  return result;
}
module.exports = { streamProtocol };
