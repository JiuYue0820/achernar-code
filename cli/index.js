#!/usr/bin/env node
'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Command } = require('commander');
const { normalizeProvider, testProvider } = require('../src/services/providers');
const reasoning = require('../src/reasoning');
const { createTools } = require('../src/services/core-tools');
const { createWorkspace, directory } = require('./workspace');
const { runAgent } = require('../src/services/agent-core');
const { createExecutionEnvironment, executionSettings } = require('./execution-environment');
const taskNotifications = require('../src/services/task-notifications').createTaskNotifications({
  send: require('../src/services/windows-notifications').createWindowsNotificationSender(),
});
const home = path.resolve(
  process.env.ACHERNAR_CLI_HOME || path.join(os.homedir(), '.achernar-cli'),
);
const credentials = require('./credentials').createCredentialStore(home);
const extensions = require('./library').createCliLibrary(path.resolve(__dirname, '..'), home);
const program = new Command().exitOverride();
program.configureOutput({
  writeErr: (text) => {
    if (!process.argv.some((arg) => ['--json', '--stream-json'].includes(arg)))
      process.stderr.write(text);
  },
});
let controller, readline, startupController, terminalUI, liveControls, taskInbox;
let taskSecrets = [];
let currentSecret = '';
const { machineEvent, englishError, systemFields } = require('./machine-output');
const { createToolHooks, runWithToolHooks } = require('./tool-hooks');
const configPath = path.join(home, 'config.json');
const read = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
};
const config = require('./config-store').createConfigReader(configPath);
const machineOutput = () => program.opts().json || program.opts().streamJson;
/** Resolve effective settings. One-run options never change the persisted profile. */
function settings() {
  const saved = config(),
    opts = program.opts();
  const apiFormat =
    opts.format || process.env.ACHERNAR_API_FORMAT || saved.apiFormat || 'openai-chat-completions';
  const standard =
    apiFormat === 'anthropic-messages'
      ? 'ANTHROPIC_API_KEY'
      : apiFormat === 'gemini'
        ? 'GEMINI_API_KEY'
        : 'OPENAI_API_KEY';
  const keyEnv = saved.keyEnv || standard;
  const baseUrl =
    opts.baseUrl ||
    process.env.ACHERNAR_BASE_URL ||
    saved.baseUrl ||
    require('../src/provider-formats').find((f) => f.id === apiFormat)?.baseUrl;
  const storedKey =
    saved.credentialId &&
    baseUrl === saved.baseUrl &&
    apiFormat === saved.apiFormat &&
    !process.env.ACHERNAR_API_KEY
      ? credentials.get(saved.credentialId)
      : '';
  const modelId = opts.model || process.env.ACHERNAR_MODEL || saved.modelId || '';
  const modelReasoning = require('../src/model-capabilities').forModel(saved, {
    baseUrl,
    apiFormat,
    modelId,
    ...reasoning.forModel(saved, { baseUrl, apiFormat, modelId }),
  });
  const result = {
    ...saved,
    ...modelReasoning,
    ...(opts.reasoning != null
      ? reasoning.select(modelReasoning, opts.reasoning)
      : reasoning.normalize(modelReasoning)),
    maxCost: opts.maxCost != null ? Number(opts.maxCost) : saved.maxCost,
    maxOutputTokens:
      opts.maxOutputTokens != null
        ? Number(opts.maxOutputTokens)
        : modelReasoning.maxOutputTokens || 16384,
    pricing:
      opts.inputPrice != null || opts.outputPrice != null
        ? {
            input: Number(opts.inputPrice ?? saved.pricing?.input),
            output: Number(opts.outputPrice ?? saved.pricing?.output),
          }
        : (opts.model || process.env.ACHERNAR_MODEL || saved.modelId) !== saved.modelId ||
            baseUrl !== saved.baseUrl ||
            apiFormat !== (saved.apiFormat || 'openai-chat-completions')
          ? null
          : saved.pricing,
    language: opts.language || saved.language || 'auto',
    runtime: require('../src/runtime-settings').normalize({
      ...saved.runtime,
      ...(opts.retries != null ? { retries: Number(opts.retries) } : {}),
      ...(opts.timeoutMs ? { commandTimeoutMs: Number(opts.timeoutMs) } : {}),
      ...(opts.taskTimeoutMs ? { taskTimeoutMs: Number(opts.taskTimeoutMs) } : {}),
    }),
    ...executionSettings({
      ...saved,
      shell: opts.shell || saved.shell,
      sandbox: opts.sandbox || saved.sandbox,
      sandboxImage: opts.sandboxImage || saved.sandboxImage,
      writePaths: opts.writeDir?.length ? opts.writeDir : saved.writePaths,
      jobMemoryMb: opts.jobMemoryMb ?? saved.jobMemoryMb,
      jobProcesses: opts.jobProcesses ?? saved.jobProcesses,
    }),
    apiFormat,
    baseUrl,
    modelId: opts.model || process.env.ACHERNAR_MODEL || saved.modelId || '',
    apiKey: process.env.ACHERNAR_API_KEY || storedKey || process.env[keyEnv] || '',
    authSource: process.env.ACHERNAR_API_KEY
      ? 'ACHERNAR_API_KEY'
      : storedKey
        ? 'Windows encrypted store'
        : process.env[keyEnv]
          ? keyEnv
          : 'missing',
    keyEnv,
  };
  currentSecret = result.apiKey;
  return result;
}
function clean(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of [currentSecret, process.env.ACHERNAR_API_KEY, ...taskSecrets].filter(
    Boolean,
  ))
    text = text.split(secret).join('[redacted]');
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}
function out(data) {
  if (terminalUI) {
    terminalUI.notice(clean(typeof data === 'string' ? data : JSON.stringify(data, null, 2)));
    return;
  }
  process.stdout.write(
    machineOutput()
      ? clean({
          ...(program.opts().streamJson ? { type: 'result' } : {}),
          ok: true,
          data: systemFields(data),
        }) + '\n'
      : typeof data === 'string'
        ? clean(data) + '\n'
        : clean(JSON.stringify(data, null, 2)) + '\n',
  );
}
function fail(error) {
  process.exitCode = 1;
  const message = clean(machineOutput() ? englishError(error) : error.message || String(error));
  if (machineOutput())
    process.stdout.write(
      JSON.stringify({
        ...(program.opts().streamJson ? { type: 'error' } : {}),
        ok: false,
        error: {
          code: require('./errors').errorCode(error),
          message,
          ...(error.status ? { status: error.status } : {}),
          ...(error.retryAfterMs ? { retryAfterMs: error.retryAfterMs } : {}),
        },
      }) + '\n',
    );
  else process.stderr.write(message + '\n');
}
const cwd = () => directory(program.opts().cwd || process.cwd());
const projectTrust = require('./project-trust').createProjectTrust(home);
let startupProject;
async function ensureProject(project = cwd()) {
  return projectTrust.ensure(project, {
    explicit: Boolean(
      program.opts().trustProject &&
      require('./project-trust').sameProject(project, startupProject),
    ),
    confirm: async (target) => {
      if (!process.stdin.isTTY || machineOutput()) return false;
      const t = (text) => require('./i18n').translate(settings().language, text);
      if (terminalUI)
        return (
          (await terminalUI.choose(
            'Trust this project?',
            [
              { value: 'cancel', command: 'Cancel', description: 'Leave this folder unopened' },
              {
                value: 'trust',
                command: 'Trust project',
                description: 'Allow project access and remember this folder',
              },
            ],
            undefined,
            {
              context: [
                target,
                t('AI can read project files and run tools under your approval settings.'),
                t('History is private to this exact folder.'),
              ],
            },
          )) === 'trust'
        );
      return /^y(?:es)?$/i.test(
        (
          await question(
            `\n${t('Trust this project?')}\n${target}\n${t('AI can read project files and run tools under your approval settings.')}\n[y/N] `,
          )
        ).trim(),
      );
    },
  });
}
async function ensureWorkspace(project = cwd(), extras = program.opts().addDir || []) {
  await ensureProject(project);
  for (const extra of extras) await ensureProject(directory(extra, project));
}
const sessionPath = (id) => require('./session-records').sessionFile(home, id, cwd());
async function sessionOperation(action, id, destination) {
  const file = sessionPath(id);
  if (!fs.existsSync(file)) throw new Error('Session not found');
  let lock;
  try {
    lock = fs.openSync(file + '.lock', 'wx');
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(
        'This session is still running. Stop it before changing or exporting history.',
        { cause: error },
      );
    throw error;
  }
  try {
    const session = read(file);
    if (!session) throw new Error('Session not found');
    await ensureWorkspace(cwd(), session.directories || []);
    const history = require('./session-history').createSessionHistory(home, id);
    const result =
      action === 'export'
        ? await require('./session-export').exportSession(session, destination, {
            secrets: [settings().apiKey, ...taskSecrets],
          })
        : await history[action](session, (next) => write(file, next), destination);
    return { session, result };
  } finally {
    require('./session-records').releaseLock(lock, file);
  }
}
async function question(text, signal) {
  if (!process.stdin.isTTY || machineOutput()) return '';
  if (terminalUI) return terminalUI.ask(clean(text), signal);
  readline ||= require('node:readline/promises').createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  return readline.question(text, { signal });
}
/** Build session-scoped tools with live approval and post-hook mutation guards. */
function createRuntime(
  project,
  session,
  signal,
  emit,
  approval = 'ask',
  plan = false,
  workspace = createWorkspace(project, program.opts().addDir),
  notifications,
  resources = [],
  context = {},
) {
  liveControls ||= new (require('./live-controls').LiveControls)({
    approval,
    mode: plan ? 'plan' : 'code',
  });
  const bases = new Map(),
    languages = new Map(),
    environment = createExecutionEnvironment(settings(), project);
  const languageFor = (root) => {
    if (!languages.has(root)) {
      const service = require('./language-tools').createLanguageTools(root, { signal });
      languages.set(root, service);
      resources.push(service);
    }
    return languages.get(root);
  };
  const baseFor = (root) => {
    if (bases.has(root)) return bases.get(root);
    const tools = createTools({
      project: root,
      runtime: settings().runtime,
      extensions,
      trackMutation: context.checkpoint
        ? (operation, scope) => context.checkpoint.track(root, operation, scope)
        : undefined,
      diagnostics: environment.allowsHostServices
        ? (args) => languageFor(root).execute(args)
        : async () => ({
            complete: false,
            diagnostics: [],
            reason: 'Host LSP is disabled in Docker mode; run compiler/tests in the container',
          }),
      terminalRunner: (command, cwd, signal, timeout, output) =>
        createExecutionEnvironment(
          settings(),
          workspace
            .list()
            .directories.filter((dir) => {
              const rel = path.relative(dir, root);
              return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
            })
            .sort((a, b) => b.length - a.length)[0] || root,
        ).run(command, cwd, signal, timeout, output),
      mcpServers: extensions.servers(root),
      signal,
      emit: (event) => emit({ ...event, project: root }),
      mode: 'all',
      shell: {
        trashItem: async (file) => {
          const trash = path.join(home, 'trash', randomUUID(), path.basename(file));
          fs.mkdirSync(path.dirname(trash), { recursive: true });
          await fs.promises.rename(file, trash);
        },
      },
      ask: async (payload) => {
        const ask = async () => {
          signal.throwIfAborted();
          const waiting = new AbortController();
          void notifications?.attention('question', undefined, {
            signal: AbortSignal.any([signal, waiting.signal]),
          });
          try {
            return await require('./agent-question').answerAgentQuestion(payload, {
              ui: terminalUI,
              question,
              signal,
            });
          } finally {
            waiting.abort();
          }
        };
        const pending = liveControls.queue.then(ask, ask);
        liveControls.queue = pending.catch(() => {});
        return pending;
      },
    });
    bases.set(root, tools);
    return tools;
  };
  const base = baseFor(project);
  const names = new Set([
    'git',
    'files',
    'terminal',
    'web',
    'skills',
    'plan',
    'ask_user',
    ...(environment.allowsHostServices ? ['mcp', 'lsp'] : []),
  ]);
  const definitions = [
    ...base.definitions,
    require('./git-tools').toolDefinition,
    ...(environment.allowsHostServices ? [require('./language-tools').toolDefinition] : []),
  ]
    .filter((d) => names.has(d.function.name))
    .map((def) => {
      const copy = structuredClone(def);
      if (['files', 'lsp', 'git'].includes(copy.function.name))
        copy.function.parameters.properties.root = {
          type: 'string',
          description:
            'Optional admitted directory; defaults to primary project. Absolute path from workspace.list.',
        };
      if (copy.function.name === 'terminal') {
        copy.function.description += ' ' + environment.description();
      }
      if (copy.function.name === 'terminal')
        copy.function.parameters.properties.cwd = {
          type: 'string',
          description: 'Optional admitted command directory; defaults to primary project.',
        };
      return copy;
    });
  const tools = {
    definitions: [...definitions, workspace.definition, liveControls.definition()],
    async execute(name, args) {
      if (
        name === 'execution_mode' &&
        (!args ||
          Object.keys(args).some((key) => !['mode', 'reason'].includes(key)) ||
          typeof args.reason !== 'string' ||
          !args.reason.trim() ||
          args.reason.length > 240)
      )
        throw new Error('Provide a mode and a concise reason.');
      liveControls.assertAllowed(name, args);
      if (!names.has(name) && !['workspace', 'execution_mode'].includes(name))
        throw new Error('Tool unavailable in coding CLI');
      if (name === 'terminal') require('./agent-policy').assertUsefulCommand(args.command);
      const target = ['files', 'lsp', 'git'].includes(name)
        ? await workspace.resolveFile(name === 'git' ? { ...args, path: '.' } : args)
        : name === 'terminal'
          ? await workspace.resolveTerminal(args)
          : { project, args };
      if (name === 'git') delete target.args.path;
      await require('./mutation-policy').assertMutationAllowed(environment, name, target);
      const prepared =
        name === 'files' ? await baseFor(target.project).prepare(name, target.args) : null;
      // workspace.add owns its directory-consent prompt; hooks never grant access.
      if (
        name !== 'workspace' &&
        !(await liveControls.authorize(name, JSON.parse(clean(args)), {
          ui: terminalUI,
          question,
          signal,
          project: target.project,
          preview: prepared && JSON.parse(clean(prepared.preview)),
          onWaiting: (waitingSignal) => {
            return notifications?.attention('approval', undefined, { signal: waitingSignal });
          },
        }))
      )
        return { denied: true, message: 'Not approved; do not bypass this refusal.' };
      // Waiting for approval can change the live mode; hooks may run scripts.
      liveControls.assertAllowed(name, args);
      const payload = { sessionId: session.id, name, arguments: args, project: target.project };
      return runWithToolHooks(context, payload, async () => {
        liveControls.assertAllowed(name, args);
        if (name === 'execution_mode') {
          liveControls.setMode(args.mode, 'agent', args.reason);
          return { mode: liveControls.mode, approval: liveControls.approval };
        }
        if (name === 'workspace') return workspace.execute(args);
        await require('./mutation-policy').assertMutationAllowed(environment, name, target);
        if (name === 'git') {
          if (
            args.action === 'stage' &&
            context.checkpoint &&
            !fs
              .statSync(path.join(target.project, '.git'), { throwIfNoEntry: false })
              ?.isDirectory()
          )
            context.checkpoint.unavailable(
              'Git index is outside the snapshotted project (worktree or nested directory); automatic task undo is unavailable.',
            );
          const operation = () =>
            require('./git-tools').createGitTools(target.project, signal).execute(target.args);
          return context.checkpoint && args.action === 'stage'
            ? context.checkpoint.track(target.project, operation)
            : operation();
        }
        if (name === 'lsp') return languageFor(target.project).execute(target.args);
        if (name === 'mcp' && args.action !== 'servers') {
          const server = extensions
            .servers(project, true, args.serverId)
            .find((s) => s.id === args.serverId && s.enabled);
          if (!server) throw new Error('MCP server is not enabled or does not exist.');
          const operation = () =>
            require('../src/services/mcp').withMcp(
              server,
              (client) =>
                args.action === 'tools'
                  ? client.listTools({}, { signal, timeout: 30000 })
                  : args.action === 'call'
                    ? client.callTool(
                        { name: args.tool, arguments: args.arguments || {} },
                        undefined,
                        { signal, timeout: 60000 },
                      )
                    : Promise.reject(new Error('Unknown MCP action.')),
              signal,
            );
          return context.checkpoint && args.action === 'call'
            ? context.checkpoint.track(project, operation)
            : operation();
        }
        return baseFor(target.project).execute(name, target.args, prepared);
      });
    },
  };
  return plan ? require('../src/services/agent-workflow').readOnly(tools) : tools;
}
/** Run one bounded task and persist its conversation, costs and undo checkpoint. */
async function execute(prompt, options = {}, saved) {
  if (!String(prompt).trim()) throw new Error('Provide a task or use chat');
  if (saved && !require('./project-trust').sameProject(saved.project, cwd()))
    throw Object.assign(
      new Error('Session belongs to another project. Open its directory first.'),
      { code: 'SESSION_PROJECT_MISMATCH' },
    );
  await ensureWorkspace(cwd(), [...(saved?.directories || []), ...(program.opts().addDir || [])]);
  const setup = settings();
  if (!setup.modelId) throw new Error('Set ACHERNAR_MODEL or run achernar config set --model <id>');
  liveControls ||= new (require('./live-controls').LiveControls)({
    approval: options.approval || 'strict',
    mode: options.plan ? 'plan' : options.review ? 'review' : 'code',
  });
  if (/^\/(plan|review)(?:\s|$)/.test(prompt))
    liveControls.setMode(prompt.match(/^\/(plan|review)/)[1], 'user');
  const project = saved?.project || cwd();
  if (!fs.statSync(project).isDirectory()) throw new Error('Project directory not found');
  const session = saved || {
    id: randomUUID(),
    project,
    createdAt: new Date().toISOString(),
    messages: [],
  };
  options.onSession?.(session);
  const notifications = taskNotifications.start({
    language: require('./i18n').resolveLocale(setup.language),
    source: 'cli',
    enabled: Boolean(
      process.stdin.isTTY &&
      process.stdout.isTTY &&
      !machineOutput() &&
      program.opts().notifications !== false,
    ),
  });
  const workspace = createWorkspace(
    project,
    [...(session.directories || []), ...(program.opts().addDir || [])],
    async (target) => {
      const waiting = new AbortController();
      void notifications.attention('approval', undefined, { signal: waiting.signal });
      try {
        const allowed = /^y(?:es)?$/i.test(
          (
            await question(`\nAllow this session to access ${target}? [y/N] `, controller?.signal)
          ).trim(),
        );
        if (allowed) await projectTrust.ensure(target, { explicit: true });
        return allowed;
      } finally {
        waiting.abort();
      }
    },
    (directories) => {
      session.directories = directories;
      write(sessionPath(session.id), session);
    },
  );
  session.directories = workspace.list().directories;
  const file = sessionPath(session.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const persist = require('./session-persist').createSessionPersist(file, session);
  const exitFlush = () => persist.flushSync();
  process.once('exit', exitFlush);
  let lock;
  try {
    lock = fs.openSync(file + '.lock', 'wx');
  } catch {
    throw new Error(
      'This session is already in use. A stale .lock may be removed only after its process exits.',
    );
  }
  controller = new AbortController();
  const inbox = require('./task-inbox').createTaskInbox();
  taskInbox = inbox;
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(setup.runtime.taskTimeoutMs),
  ]);
  const resources = [];
  const events = [],
    started = Date.now(),
    report = require('./task-report').createTaskReport();
  const emit = (event) => {
    event = machineEvent(event);
    if (program.opts().streamJson)
      process.stdout.write(clean({ type: 'event', sessionId: session.id, event }) + '\n');
    report.event(event);
    if (event.type === 'steering_applied') {
      session.messages.push({ role: 'user', content: event.text });
      persist.schedule();
    }
    if (['tool_result', 'file_change', 'plan', 'context_compacted'].includes(event.type)) {
      events.push(event);
      session.pendingEvents = events;
      persist.schedule();
    }
    if (terminalUI) terminalUI.event(JSON.parse(clean(event)));
    else if (!machineOutput()) {
      if (event.type === 'token') process.stdout.write(clean(event.delta));
      else if (event.type === 'tool_start')
        process.stderr.write(
          `\n  → ${event.name} ${clean(JSON.stringify(event.arguments)).slice(0, 180)}\n`,
        );
      else if (event.type === 'plan')
        process.stderr.write(
          '\n' +
            event.steps
              .map((s) => `  ${s.status === 'completed' ? '✓' : '·'} ${s.text}`)
              .join('\n') +
            '\n',
        );
      else if (event.type === 'terminal_output') process.stderr.write(clean(event.text));
      else if (event.type === 'output_continuation')
        process.stderr.write(`\n${event.message} (${event.attempt}/${event.limit})\n`);
    }
  };
  const history = require('./session-history').createSessionHistory(home, session.id);
  let checkpoint, modelRuntime, completed;
  try {
    await history.recover(session);
    checkpoint = history.start(session);
    session.messages.push({ role: 'user', content: prompt });
    session.updatedAt = new Date().toISOString();
    write(file, session);
    const fallbacks = (setup.fallbacks || []).map((profile) => ({
      ...profile,
      apiKey: profile.credentialId
        ? credentials.get(profile.credentialId)
        : profile.keyEnv
          ? process.env[profile.keyEnv] || ''
          : '',
    }));
    taskSecrets = [setup.apiKey, ...fallbacks.map((profile) => profile.apiKey)].filter(Boolean);
    modelRuntime = require('./model-runtime').createModelRuntime({
      primary: setup,
      fallbacks,
      maxCost: setup.maxCost,
      maxOutputTokens: setup.maxOutputTokens,
      emit,
    });
    const provider = modelRuntime.provider;
    const hooks = createToolHooks(setup.hooks, { project, signal, secrets: taskSecrets, emit });
    const mode = options.plan ? 'plan' : options.review ? 'review' : 'execute';
    const create = (childEmit) =>
      createRuntime(
        project,
        session,
        signal,
        childEmit,
        options.approval,
        false,
        workspace,
        notifications,
        resources,
        { checkpoint, hooks },
      );
    let tools = create(emit);
    if (options.agents && mode === 'execute') {
      const delegated = require('../src/services/subagents').withSubagents({
        tools,
        runtime: setup.runtime,
        config: { enabled: true, roles: ['researcher', 'reviewer'], concurrency: 2 },
        resolveProvider: async () => provider,
        createChildTools: create,
        signal,
        emit,
        project,
        taskMode: 'code',
        host: 'cli',
        rulesContext:
          workspace.instructions() +
          '\n' +
          require('./agent-policy').codingPolicy(
            process.platform,
            createExecutionEnvironment(setup, project).description(),
          ),
      });
      tools = {
        definitions: delegated.definitions,
        execute: (name, args) =>
          name === 'delegate'
            ? runWithToolHooks(
                { hooks, checkpoint },
                { sessionId: session.id, name, arguments: args, project },
                () => delegated.execute(name, args),
              )
            : delegated.execute(name, args),
      };
    }
    const result = await runAgent({
      provider,
      messages: session.messages,
      project,
      signal,
      emit,
      extensions,
      taskMode: 'code',
      host: 'cli',
      runtime: setup.runtime,
      takeMessages: () => inbox.take(),
      executionMode: mode,
      dynamicExecution: () => liveControls.mode,
      rulesContext:
        workspace.instructions() +
        '\n' +
        require('./agent-policy').codingPolicy(
          process.platform,
          createExecutionEnvironment(setup, project).description(),
        ),
      maxRounds: Math.max(1, Math.min(120, Number(options.maxRounds) || 40)),
      tools,
    });
    session.messages.push({
      role: 'assistant',
      content: result.finalContent || result.content,
      progress: result.content !== result.finalContent ? result.content : undefined,
      activities: events
        .filter((e) => e.type === 'tool_result')
        .map((e) => ({ name: e.name, arguments: e.arguments, result: e.result, failed: e.failed })),
    });
    session.status = 'complete';
    session.lastEvents = events;
    delete session.pendingEvents;
    completed = result;
  } catch (error) {
    notifications.close();
    session.status = signal.aborted ? 'canceled' : 'failed';
    session.error = clean(englishError(error));
    session.lastEvents = events;
    delete session.pendingEvents;
    session.messages.push({
      role: 'assistant',
      content: 'Task stopped before completion: ' + clean(error.message),
      error: true,
      activities: events
        .filter((e) => e.type === 'tool_result')
        .map((e) => ({ name: e.name, arguments: e.arguments, result: e.result, failed: e.failed })),
    });
    const message = englishError(error) + ` (resume ${session.id})`;
    // Abort/timeout reasons are DOMExceptions whose message is read-only; wrap those.
    const writable = Object.getOwnPropertyDescriptor(error, 'message')?.writable;
    if (error instanceof Error && writable !== false && !(error instanceof DOMException)) {
      error.message = message;
      throw error;
    }
    throw Object.assign(new Error(message, { cause: error }), {
      name: error?.name || 'Error',
      ...(typeof error?.code === 'string' ? { code: error.code } : {}),
    });
  } finally {
    await Promise.allSettled(resources.map((resource) => resource.close()));
    const remaining = inbox.close();
    taskInbox = null;
    if (terminalUI && remaining.length) {
      terminalUI.editor.set([terminalUI.editor.text, ...remaining].filter(Boolean).join('\n\n'));
      terminalUI.toast('Unsent messages restored to the editor.');
    }
    if (terminalUI) terminalUI.state.queued = 0;
    session.updatedAt = new Date().toISOString();
    try {
      if (checkpoint) session.checkpoint = await checkpoint.finish(session);
      if (modelRuntime) session.cost = modelRuntime.snapshot();
    } finally {
      try {
        await persist.flush();
        // Surface a failed save on the success path; on the error path the original
        // failure matters more than the lost persistence.
      } finally {
        process.removeListener('exit', exitFlush);
        try {
          require('./session-records').releaseLock(lock, file);
        } finally {
          controller = null;
        }
      }
    }
  }
  if (persist.failure) throw persist.failure;
  if (terminalUI) {
    terminalUI.event({
      type: 'task_complete',
      ...report.snapshot(),
      elapsed: Date.now() - started,
    });
    if (!session.checkpoint?.available)
      terminalUI.notice(
        'Undo unavailable for this task: ' +
          englishError(session.checkpoint?.reason || 'No complete snapshot'),
        'notice',
      );
  } else if (machineOutput())
    out({
      sessionId: session.id,
      ...completed,
      checkpoint: session.checkpoint,
      cost: session.cost,
      report: report.snapshot(),
      events,
    });
  else
    process.stdout.write(
      `\n\nSession ${session.id} · ${Math.round((Date.now() - started) / 1000)}s · Cost ${session.cost.costUsd == null ? 'unknown (configure pricing)' : '$' + session.cost.costUsd.toFixed(6)}${session.checkpoint?.available ? '' : ' · Undo unavailable (snapshot limit or conflict)'}\n`,
    );
  await notifications.complete();
  return session;
}
program
  .name('achernar')
  .option('--trust-project', 'explicitly trust the selected startup directory (automation)')
  .option('--no-notifications', 'disable system task notifications for this process')
  .description(
    'Achernar Code — inspect, implement, verify, resume. PowerShell on Windows; sh elsewhere.',
  )
  .version(require('../package.json').version)
  .option('--json', 'one JSON envelope on stdout; no interactive approvals')
  .option('--stream-json', 'JSONL progress events followed by a result/error envelope')
  .option(
    '-C, --cwd <path>',
    'project directory (defaults to the directory where you start achernar)',
  )
  .option(
    '--add-dir <path>',
    'allow another working directory; repeat for multiple directories',
    (value, list) => [...list, value],
    [],
  )
  .option('--no-animation', 'show a static title instead of the startup star animation')
  .option('--plain', 'use line-based chat instead of the terminal interface')
  .option('--retries <number>', 'retry transient provider failures (0-8)')
  .option('--timeout-ms <number>', 'default command timeout, up to one hour')
  .option('--task-timeout-ms <number>', 'task deadline, up to four hours')
  .option('--shell <name>', 'auto, powershell, pwsh, cmd, sh, bash or zsh')
  .option(
    '--sandbox <mode>',
    'off, restricted (write allowlist), job (Windows process limits), or docker',
  )
  .option('--job-memory-mb <number>', 'Windows Job combined memory limit in MiB (128–16384)')
  .option(
    '--job-processes <number>',
    'Windows Job maximum active processes including the shell (1–256)',
  )
  .option(
    '--write-dir <path>',
    'restricted mode file write allowlist; repeat for several directories',
    (value, list) => [...list, value],
    [],
  )
  .option('--max-cost <usd>', 'per-task USD cap; requires explicit primary/fallback pricing')
  .option('--input-price <usd>', 'input USD per million tokens')
  .option('--output-price <usd>', 'output USD per million tokens')
  .option(
    '--max-output-tokens <count>',
    'output budget including thinking (automatic for known models)',
  )
  .option('--language <locale>', 'auto, en, zh-CN, ja, ko or es; JSON system fields stay English')
  .option('--sandbox-image <image>', 'pre-pulled Linux image for Docker execution')
  .option('--model <id>', 'model ID')
  .option('--base-url <url>', 'provider API base')
  .option('--format <id>', 'API format')
  .option(
    '--reasoning <value>',
    'reasoning API value for this invocation; default omits the parameter',
  );
program
  .command('doctor')
  .description('Check runtime/config; --probe makes a read-only model discovery request')
  .option('--probe')
  .action(async (opts) => {
    const s = settings();
    let endpoint = 'not-probed',
      models;
    if (opts.probe) {
      models = await testProvider(
        { ...normalizeProvider(s), apiKey: s.apiKey },
        { signal: AbortSignal.timeout(15000) },
      );
      endpoint = 'reachable';
    }
    const execution = await createExecutionEnvironment(s, cwd()).probe();
    out({
      execution,
      languageTools:
        s.sandbox === 'docker'
          ? { enabled: false, reason: 'Host services disabled in Docker mode' }
          : require('./language-tools').languageStatus(),
      version: program.version(),
      node: process.version,
      project: cwd(),
      config: configPath,
      model: s.modelId,
      format: s.apiFormat,
      baseUrl: s.baseUrl,
      authSource: s.authSource,
      endpoint,
      ...(models ? { models } : {}),
      ready: Boolean(s.modelId && s.baseUrl),
      missing: [
        !s.modelId && 'model ID',
        !s.apiKey && 'API key (unless local endpoint is keyless)',
      ].filter(Boolean),
    });
  });
program
  .command('settings [key] [value]')
  .description('Show or save validated runtime settings')
  .action((key, value) => {
    const schema = require('../src/runtime-settings');
    if (!key) return out(settings().runtime);
    if (!schema.fields[key]) throw new Error('Unknown runtime setting: ' + key);
    if (value == null) return out({ [key]: settings().runtime[key], ...schema.fields[key] });
    const parsed =
      typeof schema.fields[key].default === 'boolean'
        ? value === 'true'
          ? true
          : value === 'false'
            ? false
            : value
        : Number(value);
    const runtime = schema.normalize({ ...settings().runtime, [key]: parsed });
    write(configPath, { ...config(), runtime });
    out({ saved: key, value: runtime[key] });
  });
const configCommand = program
  .command('config')
  .description('Configure model and endpoint; credentials stay in environment variables');
configCommand.command('show').action(() => {
  const { apiKey: _apiKey, ...s } = settings();
  out(require('./session-export').redact(s));
});
configCommand
  .command('set')
  .description('Save --model, --base-url, --format (global options) and optional --key-env')
  .option('--key-env <name>', 'environment variable holding credential')
  .action((opts) => {
    const globals = program.opts();
    if (!globals.model) throw new Error('config set requires --model <id>');
    const s = {
      ...config(),
      modelId: globals.model,
      ...(globals.baseUrl ? { baseUrl: globals.baseUrl } : {}),
      ...(globals.format ? { apiFormat: globals.format } : {}),
      ...(opts.keyEnv ? { keyEnv: opts.keyEnv } : {}),
    };
    const p = normalizeProvider({
      ...s,
      baseUrl:
        s.baseUrl ||
        require('../src/provider-formats').find(
          (f) => f.id === (s.apiFormat || 'openai-chat-completions'),
        )?.baseUrl,
    });
    const pricing =
      globals.inputPrice != null || globals.outputPrice != null
        ? require('./model-runtime').validatePricing(settings().pricing)
        : settings().pricing;
    write(configPath, {
      ...config(),
      modelId: p.modelId,
      baseUrl: p.baseUrl,
      apiFormat: p.apiFormat,
      keyEnv: s.keyEnv,
      pricing,
      ...reasoning.normalize(settings()),
    });
    out({ saved: configPath });
  });
program
  .command('reasoning [value]')
  .description('Show or save reasoning strength for the active model')
  .option('--mode <mode>', 'auto, custom, or off (omit parameter, not disable thinking)')
  .option('--options-file <path>', 'JSON array of custom {label,value} options')
  .action(async (value, opts) =>
    out(
      await require('./reasoning-menu').configureReasoning(
        value || '',
        {
          settings,
          saveSettings: (changes) => write(configPath, { ...config(), ...changes }),
          library: extensions,
        },
        opts,
      ),
    ),
  );
program
  .command('update')
  .description('Check the official CLI release; installation requires --install')
  .option('--channel <channel>', 'latest or next')
  .option('--install', 'install the checked version, then restart')
  .action(async (opts) => {
    const updates = require('./updates'),
      manifest = require('../package.json');
    const release = await updates.checkUpdate({
      currentVersion: manifest.version,
      channel: opts.channel || (manifest.version.includes('-') ? 'next' : 'latest'),
    });
    if (opts.install && release.status === 'available') {
      if (manifest.name !== updates.PACKAGE)
        throw new Error(
          'Development checkout: install the released CLI in a separate environment.',
        );
      out(await updates.installUpdate(release));
    } else out(release);
  });
for (const name of ['budget', 'pricing', 'fallbacks', 'hooks', 'language'])
  program
    .command(name + ' [value...]')
    .description('Configure ' + name + ' for subsequent CLI tasks')
    .action((value) =>
      require('./governance-menu').configureGovernance(name, value.join(' '), {
        settings,
        saveSettings: (changes) => write(configPath, { ...config(), ...changes }),
        library: extensions,
        notice: out,
      }),
    );
for (const name of ['undo', 'redo'])
  program
    .command(name + ' <id>')
    .description(name + ' the last saved task and its project file changes')
    .action(async (id) => out((await sessionOperation(name, id)).result));
program
  .command('export <id> <file>')
  .description('Export a redacted session JSON; review before sharing')
  .action(async (id, file) => out((await sessionOperation('export', id, file)).result));
program
  .command('eval')
  .description('Run fixed coding regression tasks; --live uses provider credits')
  .option('--live')
  .option('--fixture')
  .requiredOption('--out <directory>')
  .option('--threshold <rate>', 'minimum pass rate', '1')
  .option('--task <id>')
  .option('--max-rounds <count>', 'per-task model response limit', '12')
  .option('--models <ids>', 'comma-separated model IDs for a live regression matrix')
  .action(async (opts) => {
    const report = await require('./eval').main(
      [
        process.execPath,
        'eval',
        ...(opts.live ? ['--live'] : []),
        ...(opts.fixture ? ['--fixture'] : []),
        '--out',
        opts.out,
        '--threshold',
        opts.threshold,
        '--max-rounds',
        opts.maxRounds,
        ...(opts.task ? ['--task', opts.task] : []),
        ...(program.opts().taskTimeoutMs
          ? ['--task-timeout-ms', program.opts().taskTimeoutMs]
          : []),
        ...(opts.models ? ['--models', opts.models] : []),
        ...(program.opts().maxCost ? ['--max-cost', program.opts().maxCost] : []),
      ],
      {
        setup: settings(),
        log: (value) => {
          if (program.opts().streamJson)
            process.stdout.write(
              clean({ type: 'event', event: { type: 'eval_progress', ...JSON.parse(value) } }) +
                '\n',
            );
          else if (!machineOutput()) console.log(value);
        },
      },
    );
    if (machineOutput()) out(report);
  });
const execution = (command) =>
  command
    .option('--plan', 'read-only plan; no terminal, file writes or delegation')
    .option('--agents', 'enable bounded read-only researcher/reviewer subagents')
    .option('--approval <mode>', 'strict, code or auto (ask is an alias for strict)', 'strict')
    .option('--max-rounds <count>', 'bounded tool rounds', '40')
    .hook('preAction', (cmd) => {
      if (!['ask', 'strict', 'code', 'auto'].includes(cmd.opts().approval))
        throw new Error('approval must be strict, code or auto');
    });
execution(
  program
    .command('run [task...]')
    .description('Run a coding task from text, a file or piped stdin')
    .option('--task-file <path>', 'read a UTF-8 task including code blocks from a file')
    .option('--stdin', 'read a multiline task from stdin (200000-byte limit)'),
).action(async (task, opts) =>
  execute(await require('./task-input').taskInput(task, opts, cwd()), opts),
);
program
  .command('git <action>')
  .description('Structured read-only Git status/diff/log')
  .option('--staged')
  .option(
    '--path <path>',
    'literal project-relative path; repeatable',
    (value, list) => [...list, value],
    [],
  )
  .action(async (action, opts) => {
    if (!['status', 'diff', 'log'].includes(action))
      throw new Error('Use git status, diff or log. Stage changes through your Git client.');
    out(
      await require('./git-tools')
        .createGitTools(cwd(), AbortSignal.timeout(15000))
        .execute({
          action,
          staged: opts.staged,
          ...(opts.path.length ? { paths: opts.path } : {}),
        }),
    );
  });
program
  .command('session-delete <id>')
  .description('Delete session history, preserving project files')
  .requiredOption('--yes', 'confirm removing this conversation record')
  .action((id) => {
    require('./session-records').deleteSessionRecord(home, id, cwd());
    out({ deleted: id, projectFilesPreserved: true });
  });
execution(program.command('review [scope...]').description('Read-only code review')).action(
  (scope, opts) =>
    execute(
      '/review ' +
        (scope.join(' ') || 'Review this project for concrete bugs with path/line evidence.'),
      { ...opts, review: true },
    ),
);
execution(
  program
    .command('resume <id> [task...]')
    .description('Continue a saved session belonging to the current project'),
).action((id, task, opts) => {
  const s = read(sessionPath(id));
  if (!s) throw new Error('Session not found');
  if (s.pendingEvents?.length) {
    s.messages.push({
      role: 'assistant',
      content: 'Interrupted run: inspect these completed operations before continuing.',
      activities: s.pendingEvents
        .filter((e) => e.type === 'tool_result')
        .map((e) => ({ name: e.name, arguments: e.arguments, result: e.result, failed: e.failed })),
    });
    delete s.pendingEvents;
  }
  return execute(
    task.join(' ') || 'Continue pending work; verify prior actions before resuming.',
    opts,
    s,
  );
});
program
  .command('sessions')
  .alias('session')
  .description('List the latest 50 sessions in this project')
  .action(() => {
    out(
      require('./session-records')
        .listSessionFiles(home, read, cwd())
        .slice(0, 50)
        .map(({ id, project, updatedAt, status }) => ({ id, project, updatedAt, status })),
    );
  });
program
  .command('environment')
  .description('Show or persist command execution settings')
  .option('--set-shell <name>')
  .option('--set-sandbox <mode>')
  .option('--set-image <image>')
  .action(async (opts) => {
    const changes = {
      ...(opts.setShell ? { shell: opts.setShell } : {}),
      ...(opts.setSandbox ? { sandbox: opts.setSandbox } : {}),
      ...(opts.setImage ? { sandboxImage: opts.setImage } : {}),
    };
    const value = executionSettings({ ...settings(), ...changes });
    if (Object.keys(changes).length) write(configPath, { ...config(), ...value });
    out(await createExecutionEnvironment(value, cwd()).probe());
  });
program
  .command('code <action> [file]')
  .description('Read-only LSP: status, symbols, definition, references, hover, diagnostics')
  .option('--line <number>')
  .option('--column <number>')
  .action(async (action, file, opts) => {
    if (action === 'status')
      return out(
        settings().sandbox === 'docker'
          ? { enabled: false, reason: 'Host language server disabled in Docker mode' }
          : require('./language-tools').languageStatus(),
      );
    if (settings().sandbox === 'docker')
      throw new Error('Host language server disabled in Docker mode.');
    const service = require('./language-tools').createLanguageTools(cwd(), {
      signal: AbortSignal.timeout(30000),
    });
    try {
      out(
        await service.execute({
          action,
          path: file,
          ...(opts.line ? { line: Number(opts.line) } : {}),
          ...(opts.column ? { column: Number(opts.column) } : {}),
        }),
      );
    } finally {
      await service.close();
    }
  });
program
  .command('ide')
  .description('Preview VS Code tasks; --write merges missing Achernar tasks')
  .option('--write')
  .action(async (opts) => out(await require('./integration-kit').setupVscode(cwd(), opts.write)));
const extensionCommand = program
  .command('extensions')
  .description('Share and import portable Skills/plugin bundles; imported MCP stays disabled');
extensionCommand
  .command('pack <directory>')
  .requiredOption('--kind <kind>', 'skills or plugins')
  .requiredOption('--out <file>')
  .action(async (directory, opts) =>
    out(await require('./integration-kit').packExtension(directory, opts.kind, opts.out)),
  );
extensionCommand
  .command('import <file>')
  .action(async (file) => out(await require('./integration-kit').importBundle(file, extensions)));
program
  .command('inspect')
  .description('Read a bounded project file map and AGENTS.md')
  .action(async () => out(await require('../src/services/coding-context').context(cwd())));
program
  .command('search <text>')
  .description('Search project text with paths and line numbers')
  .option('--regex', 'treat text as a bounded regular expression')
  .option(
    '--include <glob>',
    'only matching files; repeat for several globs',
    (value, list) => [...list, value],
    [],
  )
  .option(
    '--exclude <glob>',
    'exclude matching files; repeat for several globs',
    (value, list) => [...list, value],
    [],
  )
  .option('--case-sensitive', 'match case exactly')
  .option('--limit <number>', 'maximum results (1-200)', '40')
  .action(async (text, opts) =>
    out(
      await require('../src/services/coding-context').search(cwd(), text, {
        ...opts,
        limit: Number(opts.limit),
      }),
    ),
  );
program
  .command('diff')
  .description('Show git diff and status without changing files')
  .action(() => {
    const git = (args) =>
      execFileSync('git', args, {
        cwd: cwd(),
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      });
    out({
      status: git(['status', '--short']),
      diff: git(['diff', '--no-ext-diff']),
      staged: git(['diff', '--cached', '--no-ext-diff']),
    });
  });
program
  .command('skills [id]')
  .description('Discover extensions or read an exact ID')
  .action((id) =>
    out(
      id
        ? extensions.detail(id)
        : extensions
            .list()
            .map(({ id, name, kind, description }) => ({ id, name, kind, description })),
    ),
  );
program
  .command('tool-call <name> <json>')
  .description('Raw read-only tool call (files/skills/web/lsp/plan only)')
  .action(async (name, json) => {
    const resources = [],
      signal = AbortSignal.timeout(30000),
      tools = createRuntime(
        cwd(),
        { id: 'inspect' },
        signal,
        () => {},
        'auto',
        true,
        undefined,
        undefined,
        resources,
      );
    try {
      out(await tools.execute(name, JSON.parse(json)));
    } finally {
      await Promise.allSettled(resources.map((resource) => resource.close()));
    }
  });
execution(
  program
    .command('chat', { isDefault: true })
    .description('Interactive coding session; /help shows terminal commands'),
).action(async (opts) => {
  if (!process.stdin.isTTY || machineOutput())
    throw new Error('chat needs an interactive terminal; use run <task> --json for automation');
  // Windows consoles expose VT support through Node even when the parent sets TERM=dumb.
  if (
    !program.opts().plain &&
    process.stdout.isTTY &&
    (process.platform === 'win32' || process.env.TERM !== 'dumb')
  )
    return startTerminalUI(opts);
  await ensureWorkspace();
  startupController = new AbortController();
  try {
    await require('./banner').showBanner({
      animate: program.opts().animation,
      signal: startupController.signal,
    });
  } catch (error) {
    if (!startupController.signal.aborted) throw error;
    return;
  } finally {
    startupController = null;
  }
  program.setOptionValue(
    'addDir',
    createWorkspace(cwd(), program.opts().addDir).list().directories.slice(1),
  );
  process.stdout.write(
    '\n  Working directory: ' +
      cwd() +
      '\n  /cd Change project · /add-dir Admit directory · /dirs List directories\n  /plan /review /test /skills /new /exit\n',
  );
  let session;
  while (true) {
    const prompt = (await question('\nAchernar › ')).trim();
    if (!prompt) continue;
    if (['/exit', '/quit'].includes(prompt)) break;
    if (prompt === '/new') {
      session = undefined;
      continue;
    }
    if (prompt === '/help') {
      process.stdout.write(
        '/plan <task>  /review <scope>  /test <scope>  /skills  /new  /exit\n/cd <path> Change project and start a new session; /add-dir <path> Admit directory; /dirs List directories\nUse the default terminal interface for interactive model and integration management.\n',
      );
      continue;
    }
    if (/^\/(?:cd|add-dir|dirs)(?:\s|$)/.test(prompt)) {
      try {
        const command = prompt.match(/^\/(\S+)/)[1],
          target = prompt.slice(command.length + 1).trim();
        const workspace = createWorkspace(session?.project || cwd(), [
          ...(session?.directories || []),
          ...program.opts().addDir,
        ]);
        if (command === 'dirs' || (command === 'cd' && !target)) out(workspace.list());
        else if (command === 'cd') {
          const next = directory(target, cwd());
          await ensureProject(next);
          if (next !== cwd()) {
            session = undefined;
            program.setOptionValue('cwd', next);
            program.setOptionValue('addDir', []);
          }
          process.stdout.write('Working directory: ' + next + '\n');
        } else {
          await ensureProject(directory(target, cwd()));
          const added = await workspace.add(target, false);
          program.setOptionValue(
            'addDir',
            added.directories.filter((root) => root !== cwd()),
          );
          if (session) {
            session.directories = added.directories;
            write(sessionPath(session.id), session);
          }
          process.stdout.write(
            (added.added ? 'Directory admitted: ' : 'Already admitted: ') +
              directory(target, workspace.list().project) +
              '\n',
          );
        }
      } catch (error) {
        process.stderr.write(clean(error.message) + '\n');
      }
      continue;
    }
    if (prompt === '/skills') {
      out(extensions.list().map((e) => ({ id: e.id, name: e.name })));
      continue;
    }
    if (/^\/(?:undo|redo|export)(?:\s|$)/.test(prompt)) {
      try {
        if (!session) throw new Error('No active session.');
        const [action, ...rest] = prompt.slice(1).split(/\s+/);
        const changed = await sessionOperation(
          action,
          session.id,
          rest.join(' ') || path.join(cwd(), 'achernar-session-' + session.id + '.json'),
        );
        session = changed.session;
        out(changed.result);
      } catch (error) {
        process.stderr.write(englishError(error) + '\n');
      }
      continue;
    }
    try {
      session = await execute(prompt, opts, session);
    } catch (e) {
      process.stderr.write(clean(e.message) + '\n');
    }
  }
});
async function startTerminalUI(opts) {
  if (!opts.agents) opts.agents = Boolean(settings().agents);
  const { TerminalUI } = require('./tui');
  program.setOptionValue(
    'addDir',
    createWorkspace(cwd(), program.opts().addDir).list().directories.slice(1),
  );
  let finish, commands;
  const done = new Promise((resolve) => {
    finish = resolve;
  });
  const leave = () => {
    terminalUI?.close();
    finish();
  };
  liveControls = new (require('./live-controls').LiveControls)({
    approval: opts.approval,
    mode: opts.plan ? 'plan' : 'code',
    onChange: (change) => {
      terminalUI.state.approval = liveControls.approval;
      terminalUI.state.mode = liveControls.mode;
      opts.approval = liveControls.approval;
      opts.plan = liveControls.mode === 'plan';
      opts.review = liveControls.mode === 'review';
      terminalUI.toast(
        `${change.type === 'approval' ? 'Approval' : 'Mode'} → ${change.value.toUpperCase()} · ${change.source === 'agent' ? 'Agent: ' + change.reason : 'Applied immediately'}`,
      );
      terminalUI.dirty = true;
    },
  });
  terminalUI = new TerminalUI({
    project: cwd(),
    model: settings().modelId,
    version: program.version(),
    language: settings().language,
    mode: opts.plan ? 'plan' : 'execute',
    animate: program.opts().animation,
    extensions: extensions.list(),
    shortcuts: config().shortcuts || {},
    onMessage: (block) => commands.messageActions(block),
    preferences: config().display || {},
    onPreference: (display) => write(configPath, { ...config(), display }),
    onSteer: (text) => {
      if (!taskInbox) throw new Error('The task has not started yet. Try again in a moment.');
      return taskInbox.push(text);
    },
    onExit: leave,
    onCancel: () => controller?.abort(new Error('Canceled by user')),
    onControl: (command) => {
      if (command === 'cycle-approval' || command === '/approval') {
        const modes = ['strict', 'code', 'auto'];
        liveControls.setApproval(modes[(modes.indexOf(liveControls.approval) + 1) % modes.length]);
      } else if (command === 'cycle-mode' || command === '/mode') {
        const modes = ['code', 'plan', 'review'];
        liveControls.setMode(modes[(modes.indexOf(liveControls.mode) + 1) % modes.length]);
      } else if (command.startsWith('/approval '))
        liveControls.setApproval(command.slice(10).trim().toLowerCase());
      else if (command.startsWith('/mode '))
        liveControls.setMode(command.slice(6).trim().toLowerCase());
    },
    onSubmit: async (prompt) => {
      if (await commands.handle(prompt)) return;
      terminalUI.begin(prompt);
      try {
        await execute(prompt, { ...opts, onSession: commands.setSession }, commands.getSession());
      } finally {
        commands.syncMessages();
      }
    },
  });
  terminalUI.state.approval = liveControls.approval;
  terminalUI.state.mode = liveControls.mode;
  commands = require('./chat-commands').createChatCommands({
    ui: terminalUI,
    options: opts,
    cwd,
    exit: leave,
    library: extensions,
    saveCredential: (baseUrl, format, key) => credentials.set(baseUrl, format, key),
    isRunning: () => Boolean(controller),
    settings: () => ({
      ...settings(),
      directories: [
        ...new Set([...(commands?.getSession()?.directories || []), ...program.opts().addDir]),
      ],
    }),
    saveSettings: (changes) =>
      require('./settings-save').saveSettings(changes, {
        settings,
        config,
        configPath,
        write,
        program,
        credentials,
      }),
    sessionOperation,
    ensureProject,
    setWorkspace: (project, directories) => {
      program.setOptionValue('cwd', project);
      program.setOptionValue('addDir', directories);
    },
    listSessions: () =>
      require('./session-records').listSessionFiles(home, read, cwd()).slice(0, 50),
    loadSession: async (id) => {
      const file = sessionPath(id);
      if (fs.existsSync(file + '.lock')) throw new Error('This session is still in use.');
      const session = read(file);
      if (session) await ensureWorkspace(cwd(), session.directories || []);
      return session;
    },
    saveSession: (session) => write(sessionPath(session.id), session),
    deleteSession: (id) => {
      if (controller) throw new Error('Stop the current task before deleting a session.');
      require('./session-records').deleteSessionRecord(home, id, cwd());
    },
    discoverModels: async () => {
      const discoveryController = new AbortController();
      try {
        const { request } = require('../src/services/providers'),
          setup = settings();
        const data = await (
          await request({ ...normalizeProvider(setup), apiKey: setup.apiKey }, 'models', {
            signal: AbortSignal.any([discoveryController.signal, AbortSignal.timeout(15000)]),
          })
        ).json();
        const items =
          setup.apiFormat === 'gemini'
            ? data.models
                ?.filter(
                  (m) =>
                    !m.supportedGenerationMethods ||
                    m.supportedGenerationMethods.includes('generateContent'),
                )
                .map((m) => ({
                  id: m.name.replace(/^models\//, ''),
                  contextWindow: m.inputTokenLimit,
                }))
            : data.data?.map((m) => ({
                id: m.id,
                contextWindow: m.context_window || m.context_length || m.max_model_len,
                reasoningDetected: Object.hasOwn(m, 'reasoning_efforts'),
                reasoningLevels: reasoning.options(m.reasoning_efforts),
              }));
        if (!Array.isArray(items)) throw new Error('Provider did not return a model list.');
        return {
          models: items.map((m) => m.id).filter((id) => typeof id === 'string'),
          metadata: Object.fromEntries(
            items.map((m) => [
              m.id,
              {
                contextWindow: Number(m.contextWindow) || undefined,
                ...(m.reasoningDetected
                  ? { reasoningDetected: true, reasoningLevels: m.reasoningLevels }
                  : {}),
              },
            ]),
          ),
        };
      } finally {
        discoveryController.abort();
      }
    },
  });
  commands.refresh();
  const cleanup = () => terminalUI?.close();
  process.once('exit', cleanup);
  try {
    terminalUI.start();
    await ensureWorkspace();
    void require('./updates').backgroundCheck({
      home,
      manifest: require('../package.json'),
      enabled: config().updateNotifications !== false,
      notify: (release) =>
        terminalUI?.toast('CLI update available: ' + release.version + ' · /update'),
    });
    await done;
  } finally {
    cleanup();
    process.removeListener('exit', cleanup);
    terminalUI = null;
    liveControls = null;
  }
}
process.on('SIGINT', () => {
  if (terminalUI) {
    if (controller) controller.abort(new Error('Canceled by user'));
    else terminalUI.onExit();
  } else if (startupController) {
    startupController.abort();
    process.exitCode = 130;
  } else if (controller) controller.abort(new Error('Canceled by user'));
  else {
    readline?.close();
    process.exitCode = 130;
  }
});
program.exitOverride();
program
  .command('trust [action]')
  .description('Show project trust; use trust revoke to require confirmation again')
  .action((action) => {
    if (action && !['status', 'revoke'].includes(action))
      throw new Error('Use trust status or trust revoke');
    if (action === 'revoke') projectTrust.revoke(cwd());
    out({ project: cwd(), trusted: projectTrust.isTrusted(cwd()) });
  });
program.hook('preAction', async (_root, command) => {
  startupProject ||= cwd();
  if (
    [
      'run',
      'resume',
      'review',
      'inspect',
      'search',
      'diff',
      'git',
      'tool-call',
      'ide',
      'sessions',
      'session-delete',
      'undo',
      'redo',
      'export',
    ].includes(command.name()) ||
    (command.name() === 'code' && command.args[0] !== 'status')
  )
    await ensureWorkspace();
});
program
  .parseAsync()
  .catch((error) => {
    if (!['commander.helpDisplayed', 'commander.version'].includes(error.code)) fail(error);
  })
  .finally(() => readline?.close());
