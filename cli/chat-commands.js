'use strict';
const { directory, createWorkspace } = require('./workspace');
const formats = require('../src/provider-formats');
const { commandCatalog } = require('./tui');
const choices = (values) =>
  values.map(([value, description]) => ({ command: value, value, description }));
function createChatCommands({
  ui,
  settings,
  saveSettings,
  cwd,
  setWorkspace,
  listSessions,
  loadSession,
  saveSession,
  deleteSession,
  discoverModels,
  options,
  exit,
  library,
  sessionOperation,
  saveCredential,
  isRunning = () => false,
  ensureProject = async () => {},
}) {
  let session;
  const t = (text) =>
    require('./i18n').translate(
      ui.state?.language || require('./i18n').resolveLocale(settings().language),
      text,
    );
  const refresh = () => {
    ui.context(cwd(), settings().modelId);
    ui.state.reasoning = require('../src/reasoning').label(settings());
    ui.metrics.limit = settings().contextWindow || 32768;
  };
  const choose = (title, values) => ui.choose(title, choices(values));
  const integrations =
    library &&
    require('./manage-integrations').createIntegrationCommands({
      ui,
      library,
      cwd,
      settings,
      saveSettings,
      refresh,
    });
  const workbench = require('./workbench-commands').createWorkbenchCommands({
    ui,
    cwd,
    settings,
    options,
    saveSettings,
    dispatch: (text) => handle(text),
  });
  const setModel = (id) => {
    if (!id.trim() || id.length > 256 || /[\s\x00-\x1f]/.test(id))
      throw new Error('Enter a model ID without whitespace (maximum 256 characters).');
    const current = settings(),
      profile = library
        ?.profiles()
        .find(
          (p) =>
            p.modelId === id.trim() &&
            p.baseUrl?.replace(/\/+$/, '') === current.baseUrl?.replace(/\/+$/, '') &&
            p.apiFormat === current.apiFormat,
        );
    saveSettings(profile || { modelId: id.trim() });
    refresh();
    ui.notice(t('Model selected: ') + id.trim());
  };
  function syncMessages() {
    let before = session?.messages.length || 0;
    for (const block of [...ui.state.logs].reverse()) {
      if (block.kind !== 'user') continue;
      const index = session?.messages
        .slice(0, before)
        .findLastIndex((message) => message.role === 'user' && message.content === block.text);
      if (index >= 0) {
        block.messageIndex = index;
        before = index;
      }
    }
  }
  function restoreConversation() {
    ui.reset();
    refresh();
    const start = Math.max(0, session.messages.length - 80);
    session.messages.slice(start).forEach((message, i) =>
      ui.notice(message.content || '', message.role === 'user' ? 'user' : 'assistant', {
        messageIndex: start + i,
      }),
    );
    const plan = session.lastEvents?.findLast((event) => event.type === 'plan');
    if (plan) ui.event(plan);
  }
  async function messageActions(block) {
    syncMessages();
    const turn = session?.turns?.find(
      (t) => t.start <= block.messageIndex && t.end > block.messageIndex,
    );
    const action = await ui.choose(t('Message actions'), [
      { value: 'copy', command: t('Copy message'), description: t('Copy the complete original text') },
      ...(!isRunning() && turn
        ? [
            {
              value: 'rewind',
              command: t('Rewind from this message'),
              description: t('Restore this task and all later tasks to their previous state'),
            },
          ]
        : []),
    ]);
    if (action === 'copy') await ui.copy(block.text);
    if (action !== 'rewind') return;
    const confirm = await ui.choose(t('Rewind conversation and files?'), [
      {
        value: 'keep',
        command: t('Keep current state'),
        description: t('Return without changing anything'),
      },
      {
        value: 'rewind',
        command: t('Rewind tasks'),
        description: t('Restore files and conversation; /redo can restore them again'),
      },
    ]);
    if (confirm !== 'rewind' || isRunning()) return;
    const changed = await sessionOperation('undoTo', session.id, turn.start);
    session = changed.session;
    restoreConversation();
    ui.editor.set(changed.result.prompt || block.text);
    ui.notice(
      t('Rewound tasks: ') + changed.result.tasks + '. ' + t('Use /redo to restore.'),
    );
  }
  async function handle(text) {
    if (await workbench.handle(text)) return true;
    if (integrations && (await integrations.handle(text))) return true;
    const match = /^\/([a-z][a-z-]*)(?:\s+([\s\S]*))?$/.exec(text);
    if (!match) return false;
    const command = { models: 'model', session: 'sessions', quit: 'exit' }[match[1]] || match[1],
      value = (match[2] || '').trim();
    if (command === 'update') {
      await require('./update-menu').configureUpdates(value, {
        ui,
        settings,
        saveSettings,
        manifest: require('../package.json'),
        isRunning,
      });
      return true;
    }
    if (command === 'shortcuts') {
      await require('./shortcuts').configureShortcuts({ ui, settings, saveSettings });
      return true;
    }
    if (command === 'reasoning') {
      await require('./reasoning-menu').configureReasoning(value, {
        settings,
        saveSettings,
        library,
        ui,
      });
      refresh();
      return true;
    }
    if (['budget', 'pricing', 'fallbacks', 'hooks', 'language'].includes(command)) {
      await require('./governance-menu').configureGovernance(command, value, {
        settings,
        saveSettings,
        library,
        ui,
      });
      return true;
    }
    if (['undo', 'redo', 'export'].includes(command)) {
      if (!session) throw new Error('No active session. Resume or run a task first.');
      const changed = await sessionOperation(
        command,
        session.id,
        value || require('node:path').join(cwd(), 'achernar-session-' + session.id + '.json'),
      );
      session = changed.session;
      if (command !== 'export') {
        restoreConversation();
        if (changed.result.prompt) ui.editor.set(changed.result.prompt);
      }
      ui.notice(
        command === 'export'
          ? t('Redacted session exported: ') + changed.result.path
          : t(command === 'undo' ? 'Undone last task' : 'Restored last task') +
            ' · ' +
            changed.result.files +
            ' ' +
            t('files'),
      );
      return true;
    }
    const routes = new Map([
      ...['exit'].map((name) => [
        name,
        async () => {
          exit();
        },
      ]),
      ...['settings'].map((name) => [
        name,
        async () => {
          await require('./runtime-menu').configureRuntime(value, { ui, settings, saveSettings });
        },
      ]),
      ...['shell', 'sandbox'].map((name) => [
        name,
        async () => {
          const {
            executionSettings,
            createExecutionEnvironment,
            shells,
          } = require('./execution-environment');
          const selected =
            value ||
            (await choose(
              t(command === 'shell' ? 'Command shell' : 'Terminal isolation'),
              command === 'shell'
                ? shells.map((name) => [
                    name,
                    name === 'auto'
                      ? t('PowerShell on Windows; sh elsewhere or in Docker')
                      : t('Must be installed in the selected environment'),
                  ])
                : [
                    ['off', t('Host permissions; approval does not isolate commands')],
                    [
                      'restricted',
                      t('File write allowlist; host MCP/LSP available; shell is not confined'),
                    ],
                    ['job', t('Windows process / memory limits; no filesystem or network isolation')],
                    [
                      'docker',
                      t('No-network container; host MCP/LSP disabled; pre-pulled image required'),
                    ],
                  ],
            ));
          if (selected) {
            const next = executionSettings({ ...settings(), [command]: selected });
            saveSettings({ [command]: next[command] });
            ui.notice(
              JSON.stringify(await createExecutionEnvironment(next, cwd()).probe(), null, 2),
            );
          }
        },
      ]),
      ...['lsp'].map((name) => [
        name,
        async () => {
          ui.notice(
            JSON.stringify(
              settings().sandbox === 'docker'
                ? { enabled: false, reason: 'Host LSP is disabled during Docker execution' }
                : require('./language-tools').languageStatus(),
              null,
              2,
            ),
          );
        },
      ]),
      ...['help'].map((name) => [
        name,
        async () => {
          const text = require('./help').helpText(
            ui.state.language,
            commandCatalog(),
            ui.state.shortcuts,
          );
          if (ui.view) await ui.view('Achernar', text);
          else ui.notice(text);
        },
      ]),
      ...['new'].map((name) => [
        name,
        async () => {
          session = undefined;
          ui.reset();
          refresh();
        },
      ]),
      ...['clear'].map((name) => [
        name,
        async () => {
          ui.state.logs = [];
          ui.state.plan = null;
          ui.state.scroll = 0;
          ui.state.scrollAnchor = null;
        },
      ]),
      ...['status', 'config'].map((name) => [
        name,
        async () => {
          const s = settings();
          ui.notice(
            t('Model: ') + (s.modelId || t('(not selected)')) +
              '\n' + t('Provider: ') + s.baseUrl +
              '\n' + t('Format: ') + s.apiFormat +
              '\n' + t('API key: ') + (s.apiKey ? t('available via') + ' ' + s.authSource : t('not configured (optional for local services)')) +
              '\n' + t('Context limit: ') + (s.contextWindow || 32768) +
              '\n' + t('Mode: ') + (ui.state.mode || (options.review ? 'review' : options.plan ? 'plan' : 'code')) +
              '\n' + t('Approval: ') + options.approval +
              '\n' + t('Subagents: ') + (options.agents ? t('enabled') : t('disabled')) +
              '\n' + t('Project: ') + cwd() +
              '\n' + t('Session: ') + (session?.id || t('(new)')) +
              '\n' + t('Reported tokens: ') + (ui.metrics.snapshot().total ?? t('unavailable')) +
              '\n\n' + t('Use /settings for configuration and /doctor for diagnostics.'),
          );
        },
      ]),
      ...['model'].map((name) => [
        name,
        async () => {
          await require('./model-picker').selectModel(value, {
            settings,
            library,
            ui,
            discoverModels,
            setModel,
            saveSettings,
            saveCredential,
            refresh,
            integrations,
            handle,
          });
        },
      ]),
      ...['provider'].map((name) => [
        name,
        async () => {
          const url =
            value ||
            (await ui.ask(
              t('Current API base: ') + settings().baseUrl + '\n' + t('Enter a new API base URL (Esc to cancel):'),
            ));
          if (url.trim()) {
            let parsed;
            try {
              parsed = new URL(url.trim());
            } catch {
              throw new Error('Enter a valid HTTP or HTTPS base URL.');
            }
            if (
              !['http:', 'https:'].includes(parsed.protocol) ||
              parsed.username ||
              parsed.password ||
              parsed.search ||
              parsed.hash
            )
              throw new Error(
                'Use an HTTP(S) URL without credentials, query parameters or fragments.',
              );
            saveSettings({ baseUrl: url.trim().replace(/\/+$/, '') });
            ui.notice(t('Provider saved: ') + settings().baseUrl);
          }
        },
      ]),
      ...['format'].map((name) => [
        name,
        async () => {
          const id =
            value ||
            (await choose(
              t('API format'),
              formats.map((f) => [f.id, f.name]),
            ));
          if (id) {
            const format = formats.find((f) => f.id === id);
            if (!format) throw new Error('Unknown API format. Use /format to choose one.');
            const defaults = formats.some((f) => f.baseUrl === settings().baseUrl);
            saveSettings({ apiFormat: id, ...(defaults ? { baseUrl: format.baseUrl } : {}) });
            ui.notice(t('API format saved: ') + format.name);
          }
        },
      ]),
      ...['context'].map((name) => [
        name,
        async () => {
          const raw =
            value ||
            (await ui.ask(
              t('Context limit: ') + (settings().contextWindow || 32768) + '\n' + t('Enter the model context limit in tokens (1024–2000000):'),
            ));
          if (raw) {
            const count = Number(raw);
            if (!Number.isInteger(count) || count < 1024 || count > 2000000)
              throw new Error('Context limit must be an integer from 1024 to 2000000.');
            saveSettings({ contextWindow: count });
            refresh();
            ui.notice(t('Context limit saved: ') + count);
          }
        },
      ]),
      ...['approval'].map((name) => [
        name,
        async () => {
          const mode =
            value ||
            (await choose(t('Approval mode'), [
              ['ask', t('Ask before file changes and commands')],
              ['auto', t('Allow file changes and shell commands automatically')],
            ]));
          if (mode) {
            if (!['ask', 'auto'].includes(mode))
              throw new Error('Use /approval ask or /approval auto.');
            if (
              mode === 'auto' &&
              options.approval !== 'auto' &&
              !/^y(?:es)?$/i.test(
                await ui.ask(
                  t('Automatic execution can modify files and run shell commands with your permissions. Enable for this CLI session? [y/N]'),
                ),
              )
            )
              return true;
            options.approval = mode;
            ui.notice(t('Approval mode: ') + mode);
          }
        },
      ]),
      ...['mode'].map((name) => [
        name,
        async () => {
          const mode =
            value ||
            (await choose(t('Execution mode'), [
              ['code', t('Read, edit and verify with tools')],
              ['plan', t('Read-only analysis; no edits or shell commands')],
            ]));
          if (mode) {
            if (!['code', 'plan'].includes(mode)) throw new Error('Use /mode code or /mode plan.');
            options.plan = mode === 'plan';
            ui.state.mode = options.plan ? 'plan' : 'execute';
            ui.notice(t('Execution mode: ') + mode);
          }
        },
      ]),
      ...['sessions', 'resume'].map((name) => [
        name,
        async () => {
          let id = value;
          if (!id) {
            id = await require('./session-picker').selectSession({
              ui,
              listSessions,
              deleteSession,
              currentId: () => session?.id,
              onDeleted: (deletedId) => {
                if (session?.id === deletedId) {
                  session = undefined;
                  ui.reset();
                  refresh();
                }
              },
            });
            if (!id) return true;
          }
          const saved = await loadSession(id);
          if (!saved) throw new Error('Session not found.');
          if (!require('./project-trust').sameProject(saved.project, cwd()))
            throw new Error('Session belongs to another project. Open its directory first.');
          const workspace = createWorkspace(saved.project, saved.directories || []);
          setWorkspace(workspace.list().project, workspace.list().directories.slice(1));
          session = saved;
          if (saved.pendingEvents?.length) {
            saved.messages.push({
              role: 'assistant',
              content: t('Interrupted task: inspect completed actions before continuing.'),
              activities: saved.pendingEvents
                .filter((e) => e.type === 'tool_result')
                .map((e) => ({
                  name: e.name,
                  arguments: e.arguments,
                  result: e.result,
                  failed: e.failed,
                })),
            });
            delete saved.pendingEvents;
            saveSession(saved);
          }
          ui.reset();
          refresh();
          for (const message of saved.messages.slice(-80))
            ui.notice(message.content || '', message.role === 'user' ? 'user' : 'assistant');
          const plan = saved.lastEvents?.findLast((event) => event.type === 'plan');
          if (plan) ui.event(plan);
          ui.notice(
            t('Resumed session') +
              ' ' +
              id +
              '. ' +
              t('Send a task to continue. Token totals start from this resume.'),
          );
        },
      ]),
      ...['cd', 'add-dir', 'dirs'].map((name) => [
        name,
        async () => {
          const workspace = createWorkspace(cwd(), settings().directories || []);
          if (command === 'dirs' || (command === 'cd' && !value))
            ui.notice(workspace.list().directories.join('\n'));
          else if (command === 'cd') {
            const target = directory(value, cwd());
            await ensureProject(target);
            if (target !== cwd()) {
              setWorkspace(target, []);
              session = undefined;
              ui.reset();
            }
            refresh();
          } else {
            await ensureProject(directory(value, cwd()));
            const result = await workspace.add(value, false);
            setWorkspace(cwd(), result.directories.slice(1));
            if (session) {
              session.directories = result.directories;
              saveSession(session);
            }
            ui.notice(t('Directory admitted: ') + directory(value, cwd()));
          }
        },
      ]),
      ...['skills'].map((name) => [
        name,
        async () => {
          ui.editor.set('/skill/');
          ui.refreshMenu();
        },
      ]),
      ...['plan', 'review', 'test'].map((name) => [
        name,
        async () => {
          return false;
        },
      ]),
    ]);
    const route = routes.get(command);
    if (!route)
      throw new Error('Unknown command: /' + command + '. Type /help for available commands.');
    return (await route()) !== false;
  }
  return {
    handle,
    getSession: () => session,
    setSession: (value) => {
      session = value;
    },
    refresh,
    syncMessages,
    messageActions,
  };
}
module.exports = { createChatCommands };
