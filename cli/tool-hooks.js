'use strict';
const { runProcess } = require('../src/services/commands');
const { redact } = require('./session-export');
function createToolHooks(
  config = {},
  { project, signal, secrets = [], env = process.env, emit = () => {} },
) {
  const names = ['tool_pre', 'tool_post'];
  for (const name of Object.keys(config))
    if (!names.includes(name)) throw new Error('Unknown hook event: ' + name);
  for (const name of names) {
    if (config[name] != null && (!Array.isArray(config[name]) || config[name].length > 10))
      throw new Error(name + ' must contain at most ten hooks.');
    for (const hook of config[name] || []) {
      if (
        !hook ||
        typeof hook.command !== 'string' ||
        !hook.command.trim() ||
        !Array.isArray(hook.args || []) ||
        hook.args?.some((a) => typeof a !== 'string') ||
        (hook.timeoutMs != null &&
          (!Number.isInteger(hook.timeoutMs) || hook.timeoutMs < 1000 || hook.timeoutMs > 60000))
      )
        throw new Error('Hooks require command, string args and a 1000–60000ms timeout.');
    }
  }
  // Deliberately exclude model credentials, NODE_OPTIONS, NODE_PATH and arbitrary
  // inherited variables. These user-installed scripts still have host permissions.
  const environment = Object.fromEntries(
    Object.entries(env).filter(([key]) =>
      /^(?:path|pathext|systemroot|windir|comspec|temp|tmp|tmpdir|home|userprofile|lang|lc_all)$/i.test(
        key,
      ),
    ),
  );
  async function invoke(event, payload) {
    const warnings = [];
    for (const hook of config[event] || []) {
      signal.throwIfAborted();
      try {
        const result = await runProcess(
          hook.command,
          hook.args || [],
          payload.project || project,
          signal,
          hook.timeoutMs || 10000,
          () => {},
          {
            env: environment,
            input: JSON.stringify(redact({ version: 1, event, ...payload }, { secrets })),
          },
        );
        if (result.timedOut || result.exitCode !== 0)
          throw new Error(
            result.timedOut ? 'Hook timed out' : 'Hook exited with code ' + result.exitCode,
          );
        let output = {};
        if (result.stdout.trim()) {
          try {
            output = JSON.parse(result.stdout);
          } catch {
            throw new Error('Hook stdout must be a JSON object or empty');
          }
          if (!output || Array.isArray(output) || typeof output !== 'object')
            throw new Error('Hook stdout must be a JSON object');
        }
        if (event === 'tool_pre' && output.decision === 'deny')
          return {
            denied: true,
            message: String(output.message || 'Denied by user hook').slice(0, 2000),
          };
      } catch (error) {
        signal.throwIfAborted();
        if (event === 'tool_pre')
          return {
            denied: true,
            message: 'Pre-hook failed; operation was not run: ' + error.message,
          };
        warnings.push(error.message);
        emit({ type: 'hook_warning', event, message: error.message });
      }
    }
    return { denied: false, warnings };
  }
  return {
    enabled: (phase) => Boolean(config[phase === 'pre' ? 'tool_pre' : 'tool_post']?.length),
    pre: (payload) => invoke('tool_pre', payload),
    post: (payload) => invoke('tool_post', payload),
  };
}
async function runWithToolHooks({ hooks, checkpoint }, payload, operation) {
  const invoke = (phase, data) =>
    hooks &&
    (checkpoint && hooks.enabled(phase)
      ? checkpoint.track(payload.project, () => hooks[phase](data))
      : hooks[phase](data));
  const pre = await invoke('pre', payload);
  if (pre?.denied) return pre;
  let result;
  try {
    result = await operation();
  } catch (error) {
    await invoke('post', { ...payload, error: require('./machine-output').englishError(error) });
    throw error;
  }
  await invoke('post', { ...payload, result });
  return result;
}
module.exports = { createToolHooks, runWithToolHooks };
