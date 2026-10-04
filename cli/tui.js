'use strict';
const { Editor, decoder } = require('./tui-input');
const { renderScreen } = require('./tui-screen');
const { Metrics } = require('./tui-metrics');
const { safeText } = require('./tui-text');
function commandCatalog(extensions = []) {
  const entries = [
    ['help', 'Show commands and keyboard shortcuts'],
    ['model', 'Choose or set a model'],
    ['provider', 'View or set the API base URL'],
    ['reasoning', 'Select reasoning strength or configure custom API values'],
    ['shortcuts', 'View and customize keyboard shortcuts'],
    ['update', 'Check or install official CLI updates'],
    ['format', 'Choose the API format'],
    ['context', 'Set the model context limit'],
    ['new', 'Start a fresh session'],
    ['clear', 'Clear the screen, keep the conversation'],
    ['sessions', 'Browse, resume or delete coding sessions'],
    ['session', 'Open sessions · resume or delete'],
    ['resume', 'Resume a session by ID'],
    ['status', 'Show model, workspace and usage'],
    ['approval', 'Strict / Code / Auto · F2 to cycle live'],
    ['mode', 'Code / Plan / Review · Shift+Tab to cycle'],
    ['plan', 'Analyze a task without modifying files'],
    ['review', 'Review code and report concrete issues'],
    ['test', 'Run relevant checks and inspect results'],
    ['cd', 'Change the working directory'],
    ['add-dir', 'Admit another working directory'],
    ['dirs', 'List working directories'],
    ['skills', 'Browse or import Skills'],
    ['plugins', 'Browse or import plugins'],
    ['mcp', 'Manage and import MCP servers'],
    ['import', 'Import models, Skills, plugins or MCP'],
    ['exit', 'Exit Achernar'],
    ['details', 'Toggle tool details · Ctrl+O'],
    ['thinking', 'Toggle reasoning display · Ctrl+T'],
    ['shell', 'Select the command shell'],
    ['sandbox', 'Host, write allowlist, Windows Job or Docker'],
    ['lsp', 'Code intelligence status'],
    ['settings', 'Models, execution, budget, extensions and language'],
    ['budget', 'Set a per-task USD cost cap'],
    ['pricing', 'Input/output USD per million tokens'],
    ['fallbacks', 'Manage the backup model chain'],
    ['hooks', 'Import user tool_pre/tool_post scripts'],
    ['language', 'Choose UI language or follow the system'],
    ['undo', 'Undo the last task and restore its prompt'],
    ['redo', 'Restore an undone task'],
    ['export', 'Export a redacted session JSON'],
    ['commands', 'Search all commands · Ctrl+P'],
    ['files', 'Browse and preview project source files'],
    ['search', 'Search code with literal / regex and include / exclude filters'],
    ['git', 'Inspect status, diffs and recent commits'],
    ['diff', 'Review staged or unstaged changes'],
    ['doctor', 'Environment diagnostics and setup checks'],
    ['cost', 'Inspect task cost, usage and model attempts'],
    ['output', 'Read the last answer in a scrollable viewer'],
    ['agents', 'Enable or disable read-only researcher / reviewer subagents'],
    ['output-limit', 'Set the maximum model output tokens'],
    ['stop', 'Stop the running task · Esc'],
  ].map(([name, description]) => ({ command: '/' + name, description }));
  return [
    ...entries,
    ...require('../src/agent-commands')
      .catalog(extensions)
      .filter((e) => e.type === 'extension')
      .map((e) => ({
        ...e,
        description: /[\u3400-\u9fff]/.test(e.description)
          ? 'Load ' + e.label + ' instructions'
          : e.description,
      })),
  ];
}
class TerminalUI {
  constructor({
    input = process.stdin,
    output = process.stdout,
    project,
    model,
    version,
    mode,
    language = 'en',
    animate = true,
    extensions = [],
    onSubmit,
    onCancel,
    onExit,
    onControl,
    onSteer,
    onPreference,
    onMessage,
    copyText = require('./clipboard').copyText,
    shortcuts = {},
    preferences = {},
    env = process.env,
  }) {
    Object.assign(this, {
      input,
      output,
      onSubmit,
      onCancel,
      onExit,
      onControl,
      onSteer,
      onPreference,
      onMessage,
      copyText,
    });
    this.color = !Object.hasOwn(env, 'NO_COLOR');
    this.animate = animate && env.ACHERNAR_NO_ANIMATION !== '1';
    this.editor = new Editor();
    this.metrics = new Metrics();
    this.catalog = commandCatalog(extensions);
    this.state = {
      editor: this.editor,
      logs: [],
      busy: false,
      question: null,
      status: '',
      mode,
      project,
      model,
      version,
      language: require('./i18n').resolveLocale(language, env),
      tick: 0,
      scroll: 0,
      menu: false,
      selected: 0,
      matches: [],
      metrics: this.metrics.snapshot(),
    };
    this.state.preferences = {
      thinking: Boolean(preferences.thinking),
      details: Boolean(preferences.details),
    };
    this.state.shortcuts = require('./shortcuts').normalize(shortcuts);
    this.state.tipIndex = 0;
    this.tipAt = Date.now();
    this.history = [];
    this.historyIndex = 0;
    this.previous = [];
    this.closed = false;
    this.parser = decoder((name, text) => this.key(name, text));
    this.receive = (chunk) => this.parser.feed(chunk);
    this.resized = () => {
      this.previous = [];
      this.draw();
    };
  }
  setLanguage(language) {
    this.state.language = require('./i18n').resolveLocale(language);
    this.previous = [];
    this.dirty = true;
  }
  start() {
    this.wasRaw = Boolean(this.input.isRaw);
    this.input.ref?.();
    this.input.setRawMode(true);
    this.input.setEncoding('utf8');
    this.input.resume();
    this.output.write('\x1b[?1049h\x1b[?2004h\x1b[?1000h\x1b[?1003h\x1b[?1006h\x1b[2J\x1b[?25l');
    this.input.on('data', this.receive);
    this.output.on('resize', this.resized);
    this.draw();
    this.timer = setInterval(() => {
      if (Date.now() - this.tipAt >= 6500) {
        this.state.tipIndex++;
        this.tipAt = Date.now();
        this.dirty = true;
      }
      if (
        this.animate &&
        ((!this.state.logs.length && !this.state.menu && !this.state.busy) ||
          (this.state.busy && !this.state.question))
      ) {
        this.state.tick++;
        this.dirty = true;
      }
      if (this.state.toast && Date.now() > this.state.toastUntil) {
        this.state.toast = '';
        this.dirty = true;
      }
      if (this.dirty) this.draw();
    }, 100);
  }
  draw() {
    if (this.closed) return;
    this.dirty = false;
    this.state.metrics = this.metrics.snapshot();
    if (
      this.selection?.active &&
      (this.selection.frame.canvas.width !== (this.output.columns || 100) - 1 ||
        this.selection.frame.canvas.height !== (this.output.rows || 30))
    )
      this.selection = null;
    const frame = this.selection?.active
        ? require('./tui-selection').render(this.selection)
        : renderScreen(this.state, this.output.columns || 100, this.output.rows || 30),
      lines = frame.canvas.lines(this.color);
    this.frame = frame;
    let bytes = '\x1b[?25l';
    for (let row = 0; row < lines.length; row++)
      if (this.previous[row] !== lines[row])
        bytes += `\x1b[${row + 1};1H` + lines[row] + '\x1b[0m\x1b[K';
    this.previous = lines;
    if (frame.cursor) bytes += `\x1b[${frame.cursor.y + 1};${frame.cursor.x + 1}H\x1b[?25h`;
    this.output.write(bytes);
  }
  refreshMenu() {
    const query = this.editor.text;
    if (this.state.picker) {
      const needle = query.trim().toLowerCase(),
        nameNeedle = needle.replace(/^\//, '');
      const score = (entry) => {
        const name = entry.command.toLowerCase().replace(/^\//, '');
        return !needle || name === nameNeedle
          ? 0
          : name.startsWith(nameNeedle)
            ? 1
            : name.includes(nameNeedle)
              ? 2
              : 3;
      };
      const translate = (text) => require('./i18n').translate(this.state.language, text);
      this.state.matches = this.state.picker.entries
        .filter((e) =>
          (
            e.command +
            ' ' +
            (e.description || '') +
            ' ' +
            translate(e.command) +
            ' ' +
            translate(e.description || '')
          )
            .toLowerCase()
            .includes(needle),
        )
        .sort((a, b) => score(a) - score(b));
      this.state.selected = 0;
      return;
    }
    this.state.menu = /^\/[^\s]*$/.test(query) && !this.state.question;
    this.state.matches = this.catalog.filter((e) =>
      e.command.toLowerCase().startsWith(query.toLowerCase()),
    );
    this.state.selected = 0;
  }
  notice(text, kind = 'notice', metadata = {}) {
    this.state.logs.push({ ...metadata, kind, text: safeText(text).slice(-50000) });
    this.state.logs = this.state.logs.slice(-100);
    this.state.scroll = 0;
    this.dirty = true;
  }
  key(name, text) {
    return require('./tui-keyboard').handleKey(this, name, text);
  }
  begin(prompt) {
    if (this.state.plan?.steps.length)
      this.state.logs.push({
        kind: 'tool',
        title: 'Task plan',
        text: this.state.plan.steps
          .map((step) => `${step.status === 'completed' ? '✓' : '○'} ${step.text}`)
          .join('\n'),
        expanded: false,
      });
    this.state.plan = null;
    this.state.cost = null;
    this.metrics.begin();
    this.state.round = 0;
    this.state.status = 'Connecting';
    this.notice(prompt, 'user');
  }
  display(key) {
    this.state.preferences[key] = !this.state.preferences[key];
    for (const block of this.state.logs)
      if (
        key === 'thinking' ? block.kind === 'reasoning' : ['tool', 'terminal'].includes(block.kind)
      ) {
        block.expanded = this.state.preferences[key];
        block.outputExpanded = this.state.preferences[key];
        block.userFolded = true;
      }
    this.onPreference?.({ ...this.state.preferences });
    this.toast(
      `${key === 'thinking' ? 'Thinking' : 'Tool details'} ${this.state.preferences[key] ? 'expanded' : 'collapsed'}`,
    );
  }
  event(event) {
    this.metrics.event(event);
    if (event.type === 'round') this.state.round = event.round;
    if (event.type === 'response_end')
      for (const block of this.state.logs)
        if (block.kind === 'assistant' && block.round === event.round) block.phase = event.phase;
    if (event.type === 'steering_applied') {
      this.state.queued = Math.max(0, (this.state.queued || 0) - 1);
      this.notice(event.text, 'user');
    }
    if (event.type === 'task_complete') {
      const commands = event.commands.map(
        (c) =>
          `• ${c.command}\n  ${c.denied ? 'Denied' : c.timedOut ? 'Timed out' : c.exitCode == null ? 'No exit code' : 'Exit ' + c.exitCode}`,
      );
      this.state.logs.push({
        kind: 'tool',
        title: `Run summary · ${event.files.length} files · ${event.tools} tools`,
        text: [
          ...event.files.map((f) => `• ${f.path} · ${f.action}`),
          ...commands,
          `Elapsed ${(event.elapsed / 1000).toFixed(1)}s`,
        ].join('\n'),
        expanded: false,
      });
    }
    if (['token', 'tool_start', 'tool_result'].includes(event.type))
      for (const block of this.state.logs) if (block.kind === 'reasoning') block.running = false;
    if (event.type === 'token') {
      let last = this.state.logs.at(-1);
      if (last?.kind !== 'assistant' || last.round !== this.state.round) {
        last = { kind: 'assistant', text: '', round: this.state.round, phase: 'streaming' };
        this.state.logs.push(last);
      }
      last.text = (last.text + safeText(event.delta)).slice(-150000);
    } else if (event.type === 'provider_retry') {
      this.state.status = `Retry ${event.attempt}/${event.limit} · waiting ${(event.waitMs / 1000).toFixed(1)}s`;
      this.toast(this.state.status + (event.status ? ` · HTTP ${event.status}` : ''));
    } else if (event.type === 'status')
      this.state.status = /连接|Connecting/i.test(event.message)
        ? 'Connecting'
        : /思考|推理|Thinking|planning/i.test(event.message)
          ? 'Thinking'
          : /生成|Generating/i.test(event.message)
            ? 'Responding'
            : /压缩|Compacting|Reducing/i.test(event.message)
              ? 'Compacting context'
              : 'Working';
    else if (event.type === 'cost') this.state.cost = event;
    else if (event.type === 'provider_fallback') {
      this.state.model = event.toModel;
      this.toast('Fallback → ' + event.toModel);
    } else if (event.type === 'hook_warning') this.notice(event.message, 'error');
    else if (event.type === 'tool_start') {
      this.state.logs.push({
        kind: 'tool',
        title: event.name + (event.name === 'terminal' ? ' · Command' : ''),
        callId: event.callId,
        toolName: event.name,
        summary: safeText(
          event.arguments?.command ||
            event.arguments?.path ||
            event.arguments?.url ||
            event.arguments?.query ||
            event.arguments?.action ||
            '',
        ),
        text: safeText(
          event.name === 'terminal'
            ? event.arguments?.command || ''
            : JSON.stringify(event.arguments || {}, null, 2),
        ).slice(-30000),
        expanded: Boolean(this.state.preferences.details),
        outputExpanded: Boolean(this.state.preferences.details),
        running: true,
      });
      this.state.scroll = 0;
    } else if (event.type === 'tool_result') {
      const block = this.state.logs.findLast((b) => b.kind === 'tool' && b.callId === event.callId);
      if (block) {
        block.running = false;
        block.failed = event.failed;
        block.duration = event.duration;
        block.rawOutput = event.result;
        if (!block.output || event.failed)
          block.output = safeText(
            require('./tui-output').formatToolResult(event.name, event.result),
          ).slice(-30000);
        if (!block.userFolded) {
          block.expanded = Boolean(this.state.preferences.details);
          block.outputExpanded = block.expanded;
        }
      } else if (event.failed) this.notice(`${event.name} · ${event.result}`, 'error');
    } else if (event.type === 'plan') {
      this.state.plan = event.steps?.length
        ? {
            expanded: true,
            offset: null,
            ...this.state.plan,
            steps: event.steps.map((step) => ({ text: safeText(step.text), status: step.status })),
          }
        : null;
    } else if (event.type === 'terminal_output') {
      const tool = this.state.logs.findLast(
        (b) => b.kind === 'tool' && b.toolName === 'terminal' && b.running,
      );
      if (tool) tool.output = ((tool.output || '') + safeText(event.text)).slice(-30000);
      else {
        let last = this.state.logs.at(-1);
        if (last?.kind !== 'terminal') {
          last = { kind: 'terminal', text: '', expanded: Boolean(this.state.preferences.details) };
          this.state.logs.push(last);
        }
        last.text = (last.text + safeText(event.text)).slice(-30000);
      }
    } else if (event.type === 'output_continuation') {
      this.state.status = 'Continuing after output limit';
      this.toast(this.state.status + ` · ${event.attempt}/${event.limit}`);
      this.notice('Output limit reached; continuing automatically.', 'tool');
    } else if (event.type === 'context_compacted') this.notice('Context compacted', 'tool');
    else if (event.type === 'budget_warning') {
      this.toast(`${event.remaining} rounds left · completing required work`);
      this.notice(
        `${event.remaining} model responses remain. The agent has been asked to finish required work and report any limits.`,
        'tool',
      );
    } else if (event.type === 'reasoning') {
      this.state.status = 'Thinking';
      let last = this.state.logs.at(-1);
      if (last?.kind !== 'reasoning') {
        last = {
          kind: 'reasoning',
          text: '',
          expanded: this.state.preferences.thinking,
          running: true,
        };
        this.state.logs.push(last);
      }
      last.text = (last.text + safeText(event.delta)).slice(-20000);
    } else if (event.type === 'subagent_start')
      this.notice(`${event.role} · ${event.task}`, 'tool');
    else if (event.type === 'subagent_done')
      this.notice(`${event.role || 'Subagent'} · ${event.error ? 'Failed' : 'Completed'}`, 'tool');
    this.state.logs = this.state.logs.slice(-100);
    this.dirty = true;
  }
  ask(text, signal) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.pending) return Promise.reject(new Error('Another question is still pending'));
    this.saveDraft();
    this.state.question = text;
    this.editor.set('');
    this.state.menu = false;
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending = null;
        this.state.question = null;
        this.state.picker = null;
        this.restoreDraft();
        reject(signal.reason);
        this.dirty = true;
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending = { resolve, cleanup: () => signal?.removeEventListener('abort', abort) };
      this.draw();
    });
  }
  choose(title, entries, signal, options = {}) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.pending) return Promise.reject(new Error('Another question is still pending'));
    this.saveDraft();
    this.state.question = title;
    this.state.picker = { title, entries, ...options };
    this.editor.set('');
    this.state.menu = false;
    this.refreshMenu();
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending = null;
        this.state.question = null;
        this.state.picker = null;
        this.restoreDraft();
        this.dirty = true;
        reject(signal.reason);
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending = { resolve, cleanup: () => signal?.removeEventListener('abort', abort) };
      this.draw();
    });
  }
  field(options) {
    if (this.pending) return Promise.reject(new Error('Another question is still pending'));
    this.saveDraft();
    this.state.form = options;
    this.state.question = options.description;
    this.state.menu = false;
    this.state.picker = null;
    this.editor.set(options.initial || '');
    return new Promise((resolve) => {
      this.pending = { resolve, cleanup() {} };
      this.draw();
    });
  }
  mouse(event) {
    if (this.selection?.dragging) {
      if ((event.button & 32 && (event.button & 3) === 0) || (!event.down && event.button === 0)) {
        this.selection.end = require('./tui-selection').point(this.selection.frame, event);
        this.selection.active ||=
          this.selection.anchor.x !== this.selection.end.x ||
          this.selection.anchor.y !== this.selection.end.y;
        if (!event.down) {
          const selected = this.selection;
          selected.dragging = false;
          if (!selected.active) {
            this.selection = null;
            if (selected.target?.action === 'user-message')
              void this.message(selected.target.index);
          }
        }
        this.draw();
        return;
      }
    }
    if (this.state.viewer && (event.button === 64 || event.button === 65)) {
      this.key(event.button === 64 ? 'pageup' : 'pagedown');
      return;
    }
    if (
      (event.button === 64 || event.button === 65) &&
      this.frame?.hitboxes?.some(
        (b) =>
          b.action === 'plan-scroll' &&
          event.x >= b.x &&
          event.x < b.x + b.width &&
          event.y >= b.y &&
          event.y < b.y + b.height,
      )
    ) {
      const plan = this.state.plan;
      if (plan) {
        plan.offset = Math.max(
          0,
          Math.min(
            this.frame.layout.planMaxOffset,
            this.frame.layout.planOffset + (event.button === 64 ? -1 : 1),
          ),
        );
        this.draw();
      }
      return;
    }
    if (
      (event.button === 64 || event.button === 65) &&
      this.frame?.hitboxes?.some(
        (b) =>
          b.action === 'preview' &&
          event.x >= b.x &&
          event.x < b.x + b.width &&
          event.y >= b.y &&
          event.y < b.y + b.height,
      )
    ) {
      this.state.approvalPreviewScroll = Math.max(
        0,
        (this.state.approvalPreviewScroll || 0) + (event.button === 64 ? -3 : 3),
      );
      this.draw();
      return;
    }
    if (event.button === 64 || event.button === 65) {
      if (this.state.picker || this.state.menu) this.key(event.button === 64 ? 'up' : 'down');
      else {
        this.state.scroll = Math.max(0, this.state.scroll + (event.button === 64 ? 3 : -3));
        this.draw();
      }
      return;
    }
    const target = this.frame?.hitboxes?.findLast(
      (b) =>
        event.x >= b.x && event.x < b.x + b.width && event.y >= b.y && event.y < b.y + b.height,
    );
    if (event.button & 32) {
      const hover = target ? `${target.action}:${target.index ?? target.value ?? ''}` : '';
      if (this.state.hover !== hover) {
        this.state.hover = hover;
        if (target?.action === 'select') this.state.selected = target.index;
        this.draw();
      }
      return;
    }
    if (!event.down || event.button !== 0) return;
    if (!this.state.question && (!target || target.action === 'user-message')) {
      const anchor = require('./tui-selection').point(this.frame, event);
      this.selection = {
        anchor,
        end: anchor,
        frame: this.frame,
        target,
        dragging: true,
        active: false,
      };
      return;
    }
    this.selection = null;
    if (target?.action === 'picker-action') {
      this.key(target.value);
      return;
    }
    if (target?.action === 'fold-plan') {
      this.key('fold-plan');
      return;
    }
    if (target?.action === 'close') {
      this.key('escape');
      return;
    }
    if (target?.action === 'approval') {
      this.onControl?.('/approval ' + target.value);
      this.draw();
      return;
    }
    if (target?.action === 'mode') {
      this.onControl?.('/mode ' + target.value);
      this.draw();
      return;
    }
    if (target?.action === 'fold' || target?.action === 'fold-output') {
      const block = this.state.logs[target.index];
      if (!block) return;
      const key = target.action === 'fold' ? 'expanded' : 'outputExpanded';
      block[key] = !block[key];
      block.userFolded = true;
      this.state.scrollAnchor = { index: target.index, action: target.action, row: target.y };
      this.draw();
      return;
    }
    if (target?.action === 'select') {
      this.state.selected = target.index;
      this.key('enter');
    }
  }
  saveDraft() {
    this.dialogDraft = { text: this.editor.text, cursor: this.editor.cursor };
  }
  restoreDraft() {
    const draft = this.dialogDraft;
    this.dialogDraft = null;
    this.editor.set(draft?.text || '');
    if (draft) this.editor.cursor = draft.cursor;
  }
  finishQuestion(answer) {
    const pending = this.pending;
    this.pending = null;
    this.state.question = null;
    this.state.picker = null;
    this.state.form = null;
    this.state.viewer = null;
    this.state.hover = '';
    if (pending) this.restoreDraft();
    pending?.cleanup();
    pending?.resolve(answer);
    this.dirty = true;
  }
  view(title, text, options = {}) {
    if (this.pending) return Promise.reject(new Error('Another question is still pending'));
    this.saveDraft();
    this.state.question = title;
    this.state.viewer = {
      title: safeText(title),
      text: safeText(text).slice(0, 200000),
      offset: 0,
      ...options,
    };
    this.state.menu = false;
    return new Promise((resolve) => {
      this.pending = { resolve, cleanup() {} };
      this.draw();
    });
  }
  async commandPalette() {
    const selected = await this.choose(
      'Command palette',
      this.catalog.map((entry) => ({ ...entry, value: entry.command })),
    );
    if (!selected) return;
    if (/^\/(?:plan|review|test|skill\/|plugin\/)/.test(selected)) {
      this.editor.set(selected + ' ' + this.editor.text);
      this.draw();
      return;
    }
    const draft = { text: this.editor.text, cursor: this.editor.cursor };
    this.state.busy = true;
    try {
      await this.onSubmit(selected);
    } catch (error) {
      this.notice(error.message, 'error');
    } finally {
      this.state.busy = false;
      if (!this.editor.text && draft.text) {
        this.editor.set(draft.text);
        this.editor.cursor = draft.cursor;
      }
      this.dirty = true;
      this.draw();
    }
  }
  async runCommand(command) {
    if (this.commandActive || this.pending) {
      this.toast('Finish the open menu first.');
      return;
    }
    this.commandActive = true;
    try {
      await this.onSubmit?.(command);
    } catch (error) {
      this.notice(error.message, 'error');
    } finally {
      this.commandActive = false;
      this.refreshMenu();
      this.draw();
    }
  }
  async copy(text) {
    try {
      await this.copyText(text);
      this.toast('Copied to clipboard.');
    } catch (error) {
      this.notice(error.message, 'error');
    }
    this.draw();
  }
  async message(index) {
    if (this.pending || this.commandActive) return;
    const block = this.state.logs[index];
    if (block?.kind !== 'user') return;
    this.commandActive = true;
    try {
      await this.onMessage?.(block);
    } catch (error) {
      this.notice(error.message, 'error');
    } finally {
      this.commandActive = false;
      this.draw();
    }
  }
  toast(text) {
    this.state.toast = safeText(text);
    this.state.toastUntil = Date.now() + 4500;
    this.dirty = true;
  }
  reset() {
    this.state.logs = [];
    this.state.plan = null;
    this.state.cost = null;
    this.state.scroll = 0;
    this.state.scrollAnchor = null;
    this.metrics.reset();
    this.dirty = true;
  }
  context(project, model) {
    this.state.project = project;
    this.state.model = model;
    this.dirty = true;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.finishQuestion('');
    this.parser.dispose();
    this.input.off('data', this.receive);
    this.output.off('resize', this.resized);
    this.input.setRawMode(this.wasRaw);
    this.input.pause();
    this.input.unref?.();
    this.output.write('\x1b[0m\x1b[?1000l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?25h\x1b[?1049l');
  }
}
module.exports = { TerminalUI, commandCatalog };
