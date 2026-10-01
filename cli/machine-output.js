'use strict';
// Translate host-owned fields only. Task text, source, stdout and model deltas
// remain byte-for-byte user/model data, even when their language is not English.
const statuses = new Map(
  Object.entries({
    正在连接模型服务: 'Connecting to model provider',
    正在生成回复: 'Generating response',
    正在思考: 'Thinking',
    回复完成: 'Response complete',
    正在请求推理模型规划: 'Requesting a planning response',
    '上下文接近上限，正在请求 AI 压缩': 'Compacting context',
    '上下文接近上限，正在精简较早的工具输出': 'Reducing older tool results',
    '摘要服务不可用，保留任务约束并精简历史结果':
      'Summary unavailable; preserving constraints and reducing historical results',
  }),
);
const nonEnglish = (value) => /[\u3400-\u9fff]/.test(value);
function englishError(error) {
  const text = String(error?.message || error || 'Operation failed');
  if (!nonEnglish(text)) return text;
  const http = text.match(/HTTP\s+(\d+)/i);
  if (http) {
    const status = Number(http[1]);
    return (
      `Provider returned HTTP ${status}. ` +
      (status === 429
        ? 'Rate limit reached; wait before retrying or configure a fallback.'
        : status >= 500
          ? 'The provider is temporarily unavailable; retry later or use a fallback.'
          : status === 401 || status === 403
            ? 'Check the API key and its permissions.'
            : 'Check the endpoint, model and request format.')
    );
  }
  const mappings = [
    [/工具参数/, 'Invalid tool arguments'],
    [/上限.*轮|轮上限/, 'Task round limit reached; completed work is preserved'],
    [/上下文容量/, 'The current request, system rules or tool arguments exceed the context window'],
    [/空回复/, 'The model returned an empty response'],
    [/输出限制/, 'Model output limit reached; resume the task'],
    [/连接|网络/, 'Provider connection failed'],
    [/模型 ID/, 'Configure a model ID first'],
    [/Base URL/, 'Invalid provider base URL'],
    [/接口格式/, 'Unsupported API format'],
    [/拒绝/, 'Operation denied; do not bypass this refusal'],
    [/找不到|不存在/, 'Requested resource not found'],
    [/只读/, 'Read-only mode does not permit this operation'],
    [/超出项目|项目根目录/, 'Path is outside the permitted scope'],
    [/超过 1 MB/, 'File exceeds 1 MB; read it in smaller ranges'],
    [/连续失败|反复请求/, 'Repeated tool failure; change the approach before retrying'],
    [/快照|撤销|恢复/, 'Checkpoint operation failed; inspect file conflicts before retrying'],
  ];
  return (
    (mappings.find(([pattern]) => pattern.test(text))?.[1] || 'Operation failed') +
    (error?.code ? ` (${error.code})` : '')
  );
}
function systemFields(value) {
  if (Array.isArray(value)) return value.map(systemFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (
        [
          'content',
          'delta',
          'text',
          'stdout',
          'stderr',
          'output',
          'arguments',
          'before',
          'after',
        ].includes(key)
      )
        return [key, entry];
      if (
        ['message', 'error', 'reason', 'status'].includes(key) &&
        typeof entry === 'string' &&
        nonEnglish(entry)
      )
        return [key, statuses.get(entry) || englishError(entry)];
      return [key, systemFields(entry)];
    }),
  );
}
function machineEvent(event) {
  const next = systemFields(event);
  if (event.type === 'status') {
    next.message =
      statuses.get(event.message) ||
      (/^正在执行 /.test(event.message)
        ? 'Running ' + event.message.slice(5)
        : /^正在读取 /.test(event.message)
          ? 'Reading selected extension'
          : englishError(event.message));
  }
  if (event.type === 'tool_result' && typeof event.result === 'string') {
    try {
      next.result = JSON.stringify(systemFields(JSON.parse(event.result)));
    } catch {
      /* Truncated result is opaque data. */
    }
  }
  if (Array.isArray(event.events)) next.events = event.events.map(machineEvent);
  if (event.event?.type) next.event = machineEvent(event.event);
  return next;
}
module.exports = { englishError, machineEvent, systemFields };
