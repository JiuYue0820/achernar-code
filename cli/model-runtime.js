'use strict';
const { normalizeProvider } = require('../src/services/providers');
const failure = (code, message) => Object.assign(new Error(message), { code });
function validatePricing(value) {
  if (value == null) return null;
  if (
    !value ||
    ['input', 'output'].some(
      (key) => typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0,
    )
  )
    throw failure(
      'INVALID_PRICING',
      'Pricing needs nonnegative input and output USD per million tokens.',
    );
  return { input: value.input, output: value.output };
}
function createModelRuntime({
  primary,
  fallbacks = [],
  maxCost,
  maxOutputTokens,
  emit = () => {},
}) {
  if (maxCost != null && (!Number.isFinite(Number(maxCost)) || Number(maxCost) <= 0))
    throw failure('INVALID_BUDGET', 'Max cost must be a positive USD amount.');
  maxOutputTokens ??=
    require('../src/model-capabilities').applyCapabilities(primary).maxOutputTokens || 16384;
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 2000000)
    throw failure('INVALID_OUTPUT_LIMIT', 'Output token limit must be between 1 and 2000000.');
  if (!Array.isArray(fallbacks) || fallbacks.length > 8)
    throw failure('INVALID_FALLBACKS', 'Configure at most eight fallback profiles.');
  const limit = maxCost == null ? null : Number(maxCost);
  const profiles = [primary, ...fallbacks]
    .map((value) => require('../src/model-capabilities').applyCapabilities(value))
    .map((value) => ({
      ...value,
      ...normalizeProvider(value),
      apiKey: value.apiKey || '',
      pricing: validatePricing(value.pricing),
    }));
  if (limit != null && profiles.some((value) => !value.pricing))
    throw failure(
      'MISSING_PRICING',
      'A cost budget requires explicit pricing for every primary/fallback model. Use zero only for a confirmed free model.',
    );
  let spent = 0,
    reserved = 0,
    unknown = 0,
    active = 0;
  const calls = [],
    breaker = new AbortController();
  const snapshot = () => ({
    costUsd: unknown ? null : spent,
    knownCostUsd: spent,
    maxCostUsd: limit,
    reservedUsd: Math.max(0, reserved),
    unpricedCalls: unknown,
    calls: calls.map((call) => ({ ...call })),
  });
  const budgetError = () =>
    failure(
      'COST_LIMIT',
      'Task cost budget exhausted or insufficient for another request. Completed work is preserved.',
    );
  const emitCost = () => emit({ type: 'cost', ...snapshot(), calls: undefined });
  const controller = {
    async stream(decorated, messages, options, send) {
      breaker.signal.throwIfAborted();
      const signal = options.signal
        ? AbortSignal.any([options.signal, breaker.signal])
        : breaker.signal;
      // A UTF-8 byte bound is deliberately more conservative than the UI token
      // estimate. Provider-specific hidden reasoning and billing remain estimates.
      const inputBound =
        Buffer.byteLength(JSON.stringify(messages)) +
        Buffer.byteLength(JSON.stringify(options.tools || [])) +
        32 * messages.length;
      for (let index = active; index < profiles.length; index++) {
        signal.throwIfAborted();
        const profile = profiles[index],
          pricing = profile.pricing;
        const inputCost = pricing ? (inputBound * pricing.input) / 1e6 : 0;
        let outputLimit = Math.min(
          options.maxTokens || maxOutputTokens,
          maxOutputTokens,
          profile.maxModelOutputTokens || profile.maxOutputTokens || maxOutputTokens,
        );
        if (limit != null) {
          const room = limit - spent - reserved - inputCost;
          if (room < 0 || limit - spent - reserved <= 0) throw budgetError();
          if (pricing.output > 0)
            outputLimit = Math.min(outputLimit, Math.floor((room * 1e6) / pricing.output));
          if (outputLimit < 1) throw budgetError();
        }
        const reservation = inputCost + (pricing ? (outputLimit * pricing.output) / 1e6 : 0);
        reserved += reservation;
        let visible = false,
          reported,
          outputBytes = 0,
          settled = false;
        const settle = (error) => {
          if (settled) return;
          settled = true;
          reserved = Math.max(0, reserved - reservation);
          const httpFailure = error && error.status >= 400 && !visible;
          const rawInput = Number(reported?.prompt_tokens ?? reported?.input_tokens);
          const rawOutput = Number(reported?.completion_tokens ?? reported?.output_tokens);
          const validUsage = [rawInput, rawOutput].every((n) => Number.isFinite(n) && n >= 0);
          const estimated = !validUsage && !httpFailure;
          const input = httpFailure ? 0 : validUsage ? rawInput : inputBound;
          // Unknown/interrupted billing consumes the entire reservation under a
          // cap; never release it just because the connection was lost.
          const output = httpFailure
            ? 0
            : validUsage
              ? rawOutput
              : limit != null
                ? outputLimit
                : Math.max(1, outputBytes);
          const cost = pricing ? (input * pricing.input + output * pricing.output) / 1e6 : null;
          if (cost == null && !httpFailure) unknown++;
          else spent += cost || 0;
          calls.push({
            model: profile.modelId,
            endpoint: profile.baseUrl,
            inputTokens: input,
            outputTokens: output,
            costUsd: cost,
            estimated,
            failed: Boolean(error),
          });
          emitCost();
          if (limit != null && spent >= limit) breaker.abort(budgetError());
        };
        const forward = (key) => (value) => {
          if ((typeof value === 'string' && value.length) || key === 'onToolDelta') visible = true;
          outputBytes += Buffer.byteLength(
            typeof value === 'string' ? value : JSON.stringify(value),
          );
          options[key]?.(value);
        };
        try {
          const value = await send(
            {
              ...profile,
              runtime: decorated.runtime || profile.runtime,
              onAttempt: ({ attempt }) => {
                if (!attempt) return;
                signal.throwIfAborted();
                // The transport reuses the same body, including its output limit.
                // Reserve that whole attempt again only when it is about to send.
                if (limit != null && spent + reserved + reservation > limit) throw budgetError();
                reserved += reservation;
                settled = false;
                reported = undefined;
              },
              onRetry: (info) => {
                // An explicit HTTP rejection has no completion charge. A dropped
                // connection might have been processed: retain its reservation as
                // estimated spend before allowing another billable request.
                settle(
                  Object.assign(new Error('Provider attempt failed before retry'), {
                    status: info.status,
                  }),
                );
                signal.throwIfAborted();
                decorated.onRetry?.({ ...info, model: profile.modelId });
              },
            },
            messages,
            {
              ...options,
              signal,
              maxTokens: outputLimit,
              onToken: forward('onToken'),
              onReasoning: forward('onReasoning'),
              onToolDelta: forward('onToolDelta'),
              onUsage: (usage) => {
                reported = usage;
                options.onUsage?.(usage);
              },
            },
          );
          settle();
          if (limit != null && spent > limit) throw budgetError();
          return value;
        } catch (error) {
          settle(error);
          if (signal.aborted) throw signal.reason;
          const eligible =
            !visible &&
            !signal.aborted &&
            (error.retryable ||
              ['TypeError', 'TimeoutError'].includes(error.name) ||
              (error.status >= 400 && error.status <= 599));
          if (!eligible || index + 1 >= profiles.length) throw error;
          active = index + 1;
          emit({
            type: 'provider_fallback',
            fromModel: profile.modelId,
            toModel: profiles[active].modelId,
            status: error.status || null,
            message: 'Switching to the configured fallback before any output.',
          });
        }
      }
      throw failure('NO_PROVIDER', 'No configured provider is available.');
    },
  };
  return {
    provider: {
      ...profiles[0],
      contextWindow: Math.min(...profiles.map((profile) => profile.contextWindow)),
      maxOutputTokens,
      chatController: controller,
    },
    snapshot,
  };
}
module.exports = { createModelRuntime, validatePricing };
