# CLI model capacities and automatic continuation

Checked: September 27, 2026.

`contextWindow` is the combined conversation capacity. `maxOutputTokens` is the
per-response generation allowance, including reasoning where the provider counts
it. These are different limits. The screenshot's `finish_reason=length` stopped
generation despite the low context meter because the CLI had a 4,096-token output
default.

The CLI now fills known models from an exact-ID catalogue. New and already saved
profiles use the catalogue unless the user explicitly selects custom limits.
Custom deployments retain their supplied limits. `/output-limit auto` restores
automatic settings; `--max-output-tokens` limits only the current invocation.
Known capacities are ceilings, not a request to generate that many tokens.
Cost caps still apply to each request and all automatic continuations.

## Verified catalogue

| Model IDs | Context | Maximum response | Strength choices |
| --- | ---: | ---: | --- |
| `deepseek-flash`, `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`, `deepseek-v4-pro` | 1,048,576 | 393,216 | none, low, high, max |
| `gpt-5` | 400,000 | 128,000 | minimal, low, medium, high |
| `gpt-5.1` | 400,000 | 128,000 | none, low, medium, high |
| `gpt-5.4`, `gpt-5.5` | 1,050,000 | 128,000 | none, low, medium, high, xhigh |
| `gpt-5.4-mini` | 400,000 | 128,000 | none, low, medium, high, xhigh |
| `o3`, `codex-mini-latest` | 200,000 | 100,000 | low, medium, high |

The DeepSeek pricing page currently says the two legacy Flash IDs are served by
DeepSeek V4.1 Flash. The CLI preserves the user's selected ID; it does not silently
rename models. `none` disables DeepSeek thinking without sending the unsupported
`reasoning_effort: none` in Chat Completions.

Sources:

- https://api-docs.deepseek.com/quick_start/pricing
- https://api-docs.deepseek.com/api/create-chat-completion (explicit `384K (393216)` limit)
- https://api-docs.deepseek.com/guides/thinking_mode
- https://api-docs.deepseek.com/quick_start/agent_integrations/codex (exact context capacity)
- https://developers.openai.com/api/docs/models/gpt-5
- https://developers.openai.com/api/docs/models/gpt-5.1
- https://developers.openai.com/api/docs/models/gpt-5.4
- https://developers.openai.com/api/docs/models/gpt-5.4-mini
- https://developers.openai.com/api/docs/models/gpt-5.5
- https://developers.openai.com/api/docs/models/o3
- https://developers.openai.com/api/docs/models/codex-mini-latest
- https://developers.openai.com/api/docs/guides/reasoning

DeepSeek pages were fetched directly. The OpenAI entries were retrieved from
official documentation indexed by Context7; direct requests from this machine
returned HTTP 403. This is a versioned, bounded catalogue, not a claim that every
current or future model has been verified. Unlisted IDs and custom endpoints are
not assigned invented capacities. Provider discovery remains available.

## Recovery behavior

- The main loop automatically compresses context before a request when history,
  instructions, tool schemas and the reserved output allowance approach capacity.
- Summarization failures fall back to progressively shortening old tool output and
  reasoning. Complete old tool exchanges can be retired together. Current task
  text, tool/result pairing and denied operations remain protected.
- Compression affects model input. It does not delete the saved conversation.
- A response with `finish_reason=length` can continue automatically up to three
  times per task. UI and JSONL announce each continuation.
- No tool calls from a truncated response execute, even if an earlier call in that
  response happens to parse. The model is told to reissue complete smaller calls.
- Repeated truncation, cancellation, cost limits, task deadlines and request-too-
  large errors remain visible failures; they do not become completion notices.
