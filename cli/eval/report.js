'use strict';
function evaluateReport(results, threshold = 1) {
  if (!results.length) throw new Error('No tasks were evaluated');
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw new Error('Pass threshold must be between zero and one');
  const passed = results.filter((result) => result.passed).length,
    passRate = passed / results.length;
  return { ok: passRate >= threshold, passed, total: results.length, passRate, threshold };
}
function executionMetrics(rows) {
  const result = rows.findLast((row) => row.type === 'result' && row.data)?.data;
  let cost = result?.cost || null,
    usage = null,
    pending;
  const flush = () => {
    if (!pending) return;
    const input = Number(pending.prompt_tokens ?? pending.input_tokens);
    const output = Number(pending.completion_tokens ?? pending.output_tokens);
    const total = Number(pending.total_tokens ?? input + output);
    if ([input, output, total].every((value) => Number.isFinite(value) && value >= 0)) {
      usage ||= { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      usage.prompt_tokens += input;
      usage.completion_tokens += output;
      usage.total_tokens += total;
    }
    pending = null;
  };
  for (const { event } of rows) {
    if (event?.type === 'usage') pending = event.usage;
    if (event?.type === 'response_end' || event?.type === 'context_usage') flush();
    if (!result?.cost && event?.type === 'cost') {
      const { type: _type, ...value } = event;
      cost = value;
    }
  }
  flush();
  return { usage: result?.totalUsage || usage, usageComplete: Boolean(result?.totalUsage), cost };
}
module.exports = { evaluateReport, executionMetrics };
