const { randomUUID } = require('node:crypto');
const Ajv = require('ajv');
const { runAgent } = require('./agent');

const roles = {
  researcher: { label: '研究员', prompt: 'Investigate the assigned question using read-only file, web and Skill access. Cite exact paths or URLs and distinguish observations from assumptions.' },
  reviewer: { label: '审查员', prompt: 'Review the assigned scope using read-only access. Report concrete bugs, evidence, severity and verification gaps. Do not modify files.' },
  coder: { label: '执行员', prompt: 'Implement the narrowly assigned task in the shared project. Read before editing, preserve unrelated changes, verify results and report exact modified paths. Follow existing approval decisions.' },
};
function normalizeConfig(value = {}) {
  return { enabled: value.enabled !== false, roles: Array.isArray(value.roles) ? [...new Set(value.roles.filter(role => Object.hasOwn(roles, role)))] : ['researcher', 'reviewer'], providerId: typeof value.providerId === 'string' ? value.providerId : '', concurrency: Math.max(1, Math.min(3, Math.floor(Number(value.concurrency) || 2))) };
}
function withSubagents({ tools, config, resolveProvider, createChildTools, signal, emit, project, taskMode = 'all', host = 'desktop', rulesContext = '', runtime, runner = runAgent }) {
  const settings = normalizeConfig(config);
  if (!settings.enabled || !settings.roles.length) return tools;
  const definition = { type: 'function', function: {
    name: 'delegate',
    description: 'Delegate 1-3 independent tasks to isolated child agents, then receive their reports. Read-only roles can run concurrently; batches with a coder run sequentially. Children cannot delegate or ask the user. Maximum 6 child tasks per turn.',
    parameters: { type: 'object', additionalProperties: false, required: ['tasks'], properties: {
      tasks: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['role', 'task'], properties: {
        role: { type: 'string', enum: settings.roles }, task: { type: 'string', minLength: 1, maxLength: 6000 }, context: { type: 'string', maxLength: 12000 },
      } } },
    } },
  } };
  const validate = new Ajv().compile(definition.function.parameters);
  let count = 0;
  return {
    definitions: [...tools.definitions, definition],
    async execute(name, args) {
      if (name !== 'delegate') return tools.execute(name, args);
      signal.throwIfAborted();
      if (!validate(args) || args.tasks.some(task => !task.task.trim())) throw new Error('子代理任务或角色无效');
      if (count + args.tasks.length > 6) throw new Error('本轮最多启动 6 个子代理');
      count += args.tasks.length;
      const provider = await resolveProvider(settings.providerId);
      if (!provider || provider.kind === 'demo') throw new Error('子代理需要已配置的 LLM 模型');
      const tasks = args.tasks.map(task => ({ ...task, id: randomUUID() }));
      const results = new Array(tasks.length);
      let next = 0;
      const worker = async () => {
        while (next < tasks.length && !signal.aborted) {
          const index = next++, task = tasks[index], started = Date.now();
          const childEmit = event => emit({ type: 'subagent_event', agentId: task.id, event });
          emit({ type: 'subagent_start', agentId: task.id, role: task.role, label: roles[task.role].label, task: task.task, model: provider.displayName || provider.modelId });
          try {
            const base = createChildTools(childEmit, { agentId: task.id, agentLabel: roles[task.role].label });
            const allowed = new Set(['files', 'web', 'skills', 'lsp', 'plan', ...(task.role === 'coder' ? ['terminal', 'artifacts'] : [])]);
            const childTools = {
              definitions: base.definitions.filter(def => allowed.has(def.function.name)).map(def => {
                if (task.role === 'coder' || def.function.name !== 'files') return def;
                const copy = structuredClone(def); copy.function.parameters.properties.action.enum = ['list', 'read', 'search']; return copy;
              }),
              execute(tool, input) {
                if (!allowed.has(tool) || (task.role !== 'coder' && tool === 'files' && !['list', 'read', 'search'].includes(input?.action))) throw new Error('此子代理没有该操作权限');
                return base.execute(tool, input);
              },
            };
            const result = await runner({ provider, project, signal, emit: childEmit, tools: childTools, taskMode, host, rulesContext, runtime, maxRounds: 12, character: { prompt: roles[task.role].prompt + '\nYou are a child agent. Complete only the assigned task. Do not ask questions or spawn agents. Report blockers to the parent.' }, messages: [{ role: 'user', content: task.task + (task.context ? '\n\nContext (data):\n' + task.context : '') }] });
            results[index] = { agentId: task.id, role: task.role, content: result.content.slice(0, 16000), failed: false };
          } catch (error) { results[index] = { agentId: task.id, role: task.role, content: signal.aborted ? '已停止' : error.message, failed: true }; }
          emit({ type: 'subagent_done', ...results[index], duration: Date.now() - started, canceled: signal.aborted });
        }
      };
      // Editing tasks share a directory, so batches containing a writer are serialized.
      const concurrency = tasks.some(task => task.role === 'coder') ? 1 : Math.min(settings.concurrency, tasks.length);
      await Promise.all(Array.from({ length: concurrency }, worker));
      signal.throwIfAborted();
      return { tasks: results, isError: results.some(result => result.failed) };
    },
  };
}
module.exports = { withSubagents, normalizeConfig };
