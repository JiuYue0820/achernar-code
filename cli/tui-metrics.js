'use strict';
class Metrics {
  constructor() {
    this.reset();
  }
  reset() {
    this.total = 0;
    this.turn = 0;
    this.rounds = new Map();
    this.round = 0;
    this.used = null;
    this.limit = 32768;
    this.estimated = true;
    this.hasUsage = false;
    this.children = new Map();
  }
  begin() {
    this.turn++;
    this.round = 0;
  }
  event(event, now = Date.now()) {
    if (event.type === 'subagent_event') {
      if (!this.children.has(event.agentId)) this.children.set(event.agentId, new Metrics());
      this.children.get(event.agentId).event(event.event, now);
      return;
    }
    if (event.type === 'round') this.round = event.round;
    const key = this.turn + ':' + this.round;
    if (event.type === 'context_usage') {
      this.used = event.estimatedTokens;
      this.limit = event.limit;
      this.estimated = true;
      if (!this.rounds.has(key))
        this.rounds.set(key, { total: 0, output: 0, start: now, end: now, reported: false });
    }
    if (event.type === 'usage') {
      const usage = event.usage || {},
        row = this.rounds.get(key) || { total: 0, start: now };
      const input = Number(usage.prompt_tokens ?? usage.input_tokens),
        output = Number(usage.completion_tokens ?? usage.output_tokens);
      if (
        ![
          usage.prompt_tokens,
          usage.input_tokens,
          usage.completion_tokens,
          usage.output_tokens,
          usage.total_tokens,
        ].some((n) => n != null && Number.isFinite(Number(n)) && Number(n) >= 0)
      )
        return;
      const total = Number(
        usage.total_tokens ??
          (Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0),
      );
      if (!Number.isFinite(total) || total < 0) return;
      this.total += total - row.total;
      this.hasUsage = true;
      Object.assign(row, {
        total,
        output: Number.isFinite(output) ? output : 0,
        end: now,
        reported: true,
      });
      this.rounds.set(key, row);
      if (Number.isFinite(input)) {
        this.used = input + (Number.isFinite(output) ? output : 0);
        this.estimated = false;
      }
    }
  }
  snapshot() {
    const reported = [...this.rounds.values()].filter((r) => r.reported);
    const milliseconds = reported.reduce((n, r) => n + Math.max(1, r.end - r.start), 0);
    const output = reported.reduce((n, r) => n + (r.output || 0), 0);
    const children = [...this.children.values()]
      .map((m) => m.snapshot())
      .filter((m) => m.total != null);
    return {
      total:
        this.hasUsage || children.length
          ? this.total + children.reduce((n, m) => n + m.total, 0)
          : null,
      // Below ~250 ms of streaming the ratio is noise (e.g. 900000 token/s), so hold it back.
      rate: milliseconds >= 250 ? output / (milliseconds / 1000) : null,
      used: this.used,
      limit: this.limit,
      estimated: this.estimated,
    };
  }
}
module.exports = { Metrics };
