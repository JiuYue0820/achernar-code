const { randomUUID } = require('node:crypto');
const reasoning = require('../reasoning');
const formats = require('../provider-formats');
const { streamProtocol } = require('./llm-protocols');
function normalizeProvider(input = {}) {
  input = require('../model-capabilities').applyCapabilities(input);
  if (input.apiFormat && !formats.some(format => format.id === input.apiFormat)) throw new Error('暂不支持此 LLM 接口格式');
  const p = {
    id: String(input.id || randomUUID()), kind: ['demo', 'ollama', 'local-file'].includes(input.kind) ? input.kind : 'openai',
    ...(input.groupId ? { groupId: String(input.groupId) } : {}),
    apiFormat: ['ollama', 'local-file', 'demo'].includes(input.kind) ? 'openai-chat-completions' : input.apiFormat || 'openai-chat-completions',
    name: String(input.name || '').trim(), baseUrl: String(input.baseUrl || '').trim().replace(/\/+$/, ''),
    modelId: String(input.modelId || '').trim(), displayName: String(input.displayName || '').trim(),
    contextWindow: Math.max(1024, Math.min(2000000, Number(input.contextWindow) || 32768)),
    ...(input.maxOutputTokens ? { maxOutputTokens: Number(input.maxOutputTokens) } : {}),
    ...(input.maxInputTokens ? { maxInputTokens: Number(input.maxInputTokens) } : {}),
    ...(input.limitsMode ? { limitsMode: input.limitsMode } : {}),
    ...reasoning.normalize(input),
    vision: Boolean(input.vision),
    localModelPath: String(input.localModelPath || '').trim(),
    localExecutable: String(input.localExecutable || 'llama-server').trim(),
  };
  if (p.kind === 'ollama' && !p.baseUrl) p.baseUrl = 'http://127.0.0.1:11434/v1';
  if (p.kind === 'local-file' && !p.baseUrl) p.baseUrl = 'http://127.0.0.1:8080/v1';
  if (p.kind !== 'demo') endpoint(p, 'models');
  return p;
}
function endpoint(provider, route) {
  let url;
  try { url = new URL(provider.baseUrl.replace(/\/+$/, '')); } catch { throw new Error('请填写有效的 Base URL，例如 https://api.openai.com/v1'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Base URL 仅支持不含凭据或查询参数的 HTTP / HTTPS 地址');
  return new URL(url.href.replace(/\/+$/, '') + '/' + route);
}
// Re-arm the inactivity deadline on every body chunk; stop it when the body ends.
function watchProgress(response, touch, stop) {
  if (!response.body) { stop(); return response; }
  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { stop(); controller.close(); return; }
        touch(); controller.enqueue(value);
      } catch (error) { stop(); controller.error(error); }
    },
    cancel(reason) { stop(); return reader.cancel(reason); },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
async function request(provider, route, options = {}) {
  const runtime = require('../runtime-settings').normalize(provider.runtime);
  const auth = provider.apiFormat === 'anthropic-messages' ? { 'anthropic-version': '2023-06-01', ...(provider.apiKey ? { 'x-api-key': provider.apiKey } : {}) }
    : provider.apiFormat === 'gemini' ? (provider.apiKey ? { 'x-goog-api-key': provider.apiKey } : {})
    : (provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {});
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    // Request governance runs outside the transport catch/retry path, so a
    // budget refusal cannot itself be retried as a connection failure.
    provider.onAttempt?.({ attempt });
    let error, retryAfter = 0;
    // requestTimeoutMs is an inactivity deadline: every received chunk extends it, so a long
    // but steadily streaming generation is not cut off while a stalled connection still is.
    const idle = new AbortController();
    let timer;
    const touch = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(new DOMException('Model request made no progress within the request deadline', 'TimeoutError')), runtime.requestTimeoutMs); timer.unref?.(); };
    touch();
    try {
      const response = await fetch(endpoint(provider, route), {
        ...options, redirect: 'error',
        headers: { 'Content-Type': 'application/json', ...auth, ...options.headers },
        signal: options.signal ? AbortSignal.any([options.signal, idle.signal]) : idle.signal,
      });
      if (response.ok) { touch(); return watchProgress(response, touch, () => clearTimeout(timer)); }
      clearTimeout(timer);
      error = Object.assign(new Error(`模型服务返回 HTTP ${response.status}${response.status === 401 ? '，请检查 API Key' : response.status === 404 ? '，请检查 Base URL 和模型 ID' : ''}`), { status: response.status, code: 'PROVIDER_HTTP_ERROR', retryable: [408, 429, 500, 502, 503, 504].includes(response.status) });
      const header = response.headers.get('retry-after');
      if (header) retryAfter = /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : Math.max(0, Date.parse(header) - Date.now()) || 0;
      await response.body?.cancel().catch(() => {});
    } catch (cause) {
      clearTimeout(timer);
      options.signal?.throwIfAborted();
      if (!['TypeError', 'TimeoutError'].includes(cause.name)) throw cause;
      // fetch() reports "fetch failed"; the actionable reason (ENOTFOUND, ECONNREFUSED, TLS) lives on cause.cause.
      const root = cause.cause || cause, reason = cause.name === 'TimeoutError' ? 'timeout' : root.code || root.message || cause.message;
      let host = ''; try { host = endpoint(provider, route).host; } catch { /* validated before fetch */ }
      const detail = [host, reason].filter(Boolean).join(': ');
      error = Object.assign(new Error('模型连接暂时失败：' + detail, { cause }), { retryable: true, code: 'PROVIDER_CONNECTION_ERROR', detail });
    }
    // Rate limits without Retry-After usually clear within tens of seconds; ensure 5 retries
    const rateLimited = error.status === 429 && !retryAfter;
    const limit = rateLimited ? Math.max(runtime.retries, 5) : runtime.retries;
    if (!error.retryable || attempt >= limit || retryAfter > runtime.retryMaxMs) {
      if (retryAfter) error.retryAfterMs = retryAfter;
      throw error;
    }
    const exponential = Math.min(runtime.retryMaxMs, runtime.retryBaseMs * 2 ** attempt);
    const waitMs = Math.max(retryAfter, Math.floor(exponential * (0.5 + Math.random() * 0.5)));
    provider.onRetry?.({ attempt: attempt + 1, limit, waitMs, status: error.status });
    await require('node:timers/promises').setTimeout(waitMs, undefined, { signal: options.signal });
  }
}
async function testProvider(provider) {
  if (provider.kind === 'demo') return { ok: true, models: [], message: '演示模式已就绪' };
  try {
    const data = await (await request(provider, 'models')).json();
    if (provider.apiFormat === 'gemini') {
      if (!Array.isArray(data.models)) throw new Error('服务没有返回 Gemini 模型列表');
      const models = data.models.filter(model => !model.supportedGenerationMethods || model.supportedGenerationMethods.includes('generateContent'));
      return { ok: true, models: models.map(model => model.name.replace(/^models\//, '')).sort(), metadata: Object.fromEntries(models.map(model => [model.name.replace(/^models\//, ''), { contextWindow: model.inputTokenLimit }])), message: '连接成功' };
    }
    if (!Array.isArray(data.data)) throw new Error('服务没有返回 OpenAI 兼容的模型列表');
    const metadata = Object.fromEntries(data.data.filter(x => typeof x.id === 'string').map(x => [x.id, { contextWindow: Number(x.context_window || x.context_length || x.max_model_len) || undefined, vision: Array.isArray(x.modalities) ? x.modalities.includes('image') : undefined, reasoningDetected: Object.prototype.hasOwnProperty.call(x, 'reasoning_efforts'), reasoningLevels: Array.isArray(x.reasoning_efforts) ? reasoning.options(x.reasoning_efforts) : undefined }]));
    return { ok: true, models: data.data.map(x => x.id).filter(x => typeof x === 'string').sort(), metadata, message: '连接成功' };
  } catch (error) { return { ok: false, models: [], message: error.message }; }
}
// A packet may split a UTF-8 character or an SSE event at any byte boundary.
async function readStream(body, onEvent) {
  const decoder = new TextDecoder();
  let buffer = '', done = false;
  const consume = line => { if (line.startsWith('data:')) { const data = line.slice(5).trim(); if (data === '[DONE]') done = true; else if (data) onEvent(JSON.parse(data)); } };
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, index).replace(/\r$/, '')); buffer = buffer.slice(index + 1); }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer.replace(/\r$/, ''));
  return done;
}
function streamChat(provider, messages, options = {}) {
  return provider.chatController ? provider.chatController.stream(provider, messages, options, streamChatDirect) : streamChatDirect(provider, messages, options);
}
async function streamChatDirect(provider, messages, { signal, onToken = () => {}, onUsage = () => {}, onReasoning = () => {}, onToolDelta = () => {}, tools, maxTokens }) {
  maxTokens ||= provider.maxOutputTokens;
  if (provider.apiFormat && provider.apiFormat !== 'openai-chat-completions') return streamProtocol(provider, messages, { signal, onToken, onUsage, onReasoning, onToolDelta, tools, maxTokens }, { request, readStream });
  const calls = new Map(); let content = '', reasoningContent = '', finishReason;
  const consumeMessage = message => {
    const reasoning = message?.reasoning_content ?? message?.reasoning;
    if (typeof reasoning === 'string' && reasoning) { reasoningContent += reasoning; onReasoning(reasoning); }
    if (typeof message?.content === 'string') { content += message.content; onToken(message.content); }
    for (const [position, delta] of (message?.tool_calls || []).entries()) {
      const index = delta.index ?? position;
      const call = calls.get(index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (delta.id) call.id = delta.id;
      if (delta.function?.name) call.function.name += delta.function.name;
      if (delta.function?.arguments) call.function.arguments += delta.function.arguments;
      if (call.function.arguments.length > 200000 || calls.size > 32) throw new Error('模型工具调用超过大小限制');
      calls.set(index, call);
      onToolDelta(call);
    }
  };
  const body = { model: provider.modelId, messages, stream: true, stream_options: { include_usage: true } };
  if (maxTokens) body[/^(?:gpt-5|gpt-6|o[134])(?:[.-]|$)/.test(provider.modelId) && new URL(provider.baseUrl).hostname === 'api.openai.com' ? 'max_completion_tokens' : 'max_tokens'] = maxTokens;
  if (tools?.length) { body.tools = tools; body.tool_choice = 'auto'; }
  const effort = reasoning.normalize(provider).reasoningLevel;
  if (effort) body.reasoning_effort = effort;
  if (reasoning.isDeepSeek(provider)) {
    if (effort) body.thinking = { type: effort === 'none' ? 'disabled' : 'enabled' };
    if (effort === 'none') delete body.reasoning_effort;
    body.messages = messages.map(message => message.role === 'assistant' ? { ...message, reasoning_content: message.reasoning_content || '' } : message);
  }
  const response = await request(provider, 'chat/completions', { method: 'POST', signal, body: JSON.stringify(body) });
  if (response.headers.get('content-type')?.includes('application/json')) {
    const data = await response.json();
    if (data.error) throw new Error('模型服务返回错误');
    consumeMessage(data.choices?.[0]?.message);
    if (data.usage) onUsage(data.usage);
    return { content, reasoning: reasoningContent, toolCalls: [...calls.values()], finishReason: data.choices?.[0]?.finish_reason };
  }
  const done = await readStream(response.body, data => {
    if (data.error) throw new Error('模型服务在流式响应中返回错误');
    consumeMessage(data.choices?.[0]?.delta);
    if (data.choices?.[0]?.finish_reason) finishReason = data.choices[0].finish_reason;
    if (data.usage) onUsage(data.usage);
  });
  if (!finishReason && !done) throw Object.assign(new Error('Provider stream ended before a completion marker; partial output is preserved.'), { code: 'PROVIDER_STREAM_INCOMPLETE' });
  return { content, reasoning: reasoningContent, toolCalls: [...calls.values()], finishReason };
}
module.exports = { normalizeProvider, endpoint, testProvider, streamChat, readStream, request };
