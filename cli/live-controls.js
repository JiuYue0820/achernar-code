'use strict';
const codeFiles =
  /\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|kts|c|h|cc|cpp|hpp|cs|swift|m|mm|php|rb|sh|ps1|bat|cmd|sql|html?|css|scss|sass|less|vue|svelte|json|jsonc|ya?ml|toml|xml|md|mdx|txt|ini|cfg|conf|gradle|cmake|dockerfile)$/i;
const controlTools = new Set(['plan', 'ask_user', 'execution_mode']);
function normalizeApproval(mode) {
  return mode === 'ask' ? 'strict' : mode;
}
function requiresApproval(mode, name, args = {}) {
  if (
    controlTools.has(name) ||
    (name === 'mcp' && args.action === 'servers') ||
    (name === 'workspace' && args.action === 'list')
  )
    return false;
  if (mode === 'auto') return false;
  if (mode === 'code' && name === 'lsp') return false;
  if (
    mode === 'code' &&
    name === 'files' &&
    ['read', 'list', 'search', 'write', 'edit'].includes(args.action)
  ) {
    return !(
      ['list', 'search'].includes(args.action) ||
      codeFiles.test(String(args.path || '')) ||
      /(?:^|[\\/])(?:Dockerfile|Makefile|CMakeLists\.txt|\.gitignore)$/i.test(
        String(args.path || ''),
      )
    );
  }
  return true;
}
function readOnlyAllowed(name, args) {
  return (
    controlTools.has(name) ||
    {
      git: ['status', 'diff', 'log'],
      lsp: ['symbols', 'definition', 'references', 'hover', 'diagnostics'],
      files: ['read', 'list', 'search'],
      skills: ['list', 'read'],
      web: ['read', 'search'],
      workspace: ['list'],
      mcp: ['servers'],
    }[name]?.includes(args?.action)
  );
}
class LiveControls {
  constructor({ approval = 'strict', mode = 'code', onChange = () => {} } = {}) {
    this.approval = normalizeApproval(approval);
    this.mode = mode;
    this.userLocked = mode !== 'code';
    this.onChange = onChange;
    this.queue = Promise.resolve();
  }
  setApproval(value) {
    const mode = normalizeApproval(value);
    if (!['strict', 'code', 'auto'].includes(mode))
      throw new Error('Approval must be strict, code or auto.');
    this.approval = mode;
    this.onChange({ type: 'approval', value: mode, source: 'user' });
    if (this.pending && !requiresApproval(mode, this.pending.name, this.pending.args))
      this.pending.accept();
  }
  setMode(mode, source = 'user', reason = '') {
    if (mode === 'execute') mode = 'code';
    if (!['code', 'plan', 'review'].includes(mode))
      throw new Error('Execution mode must be code, plan or review.');
    if (source === 'agent' && mode === 'code' && this.userLocked)
      throw new Error('User selected a read-only mode. Only the user can enable Code.');
    this.mode = mode;
    if (source === 'user') this.userLocked = mode !== 'code';
    this.onChange({ type: 'mode', value: mode, source, reason });
  }
  assertAllowed(name, args) {
    if (this.mode !== 'code' && !readOnlyAllowed(name, args))
      throw new Error(
        `Execution mode is ${this.mode}. Switch to Code before modifying files or running commands.`,
      );
  }
  async authorize(name, args, { ui, question, signal, project, preview, onWaiting = () => {} }) {
    this.assertAllowed(name, args);
    if (!requiresApproval(this.approval, name, args)) return true;
    const run = async () => {
      signal.throwIfAborted();
      this.assertAllowed(name, args);
      if (!requiresApproval(this.approval, name, args)) return true;
      const waiting = new AbortController();
      const waitingSignal = AbortSignal.any([signal, waiting.signal]);
      Promise.resolve()
        .then(() => {
          if (!waitingSignal.aborted) return onWaiting(waitingSignal);
        })
        .catch(() => {});
      try {
        if (!ui)
          return /^y(?:es)?$/i.test(
            (
              await question(
                `\nDirectory: ${project}\n${preview?.diff ? preview.diff + '\n' : ''}Allow ${name} ${JSON.stringify(preview ? { action: args.action, path: args.path } : args).slice(0, 1200)}? [y/N] `,
                signal,
              )
            ).trim(),
          );
        // The request already has a tool card; detailed approval stays in its modal.
        ui.state.approvalRequest = { name, arguments: args, project, preview };
        ui.state.approvalPreviewScroll = 0;
        const accept = () => ui.finishQuestion('allow');
        const t = (text) => require('./i18n').translate(ui.state?.language, text);
        this.pending = { name, args, accept };
        try {
          while (true) {
            const answer = await ui.choose(
              t('Permission') + ' · ' + name,
              [
                { command: t('Allow once'), value: 'allow', description: t('Run this operation') },
                { command: t('Deny'), value: 'deny', description: t('Skip this operation') },
                { command: t('Strict'), value: 'strict', description: t('Ask for all operations') },
                {
                  command: t('Code'),
                  value: 'code',
                  description: t('Auto-approve code edits; ask for others'),
                },
                { command: t('Auto'), value: 'auto', description: t('Approve all operations') },
              ],
              signal,
            );
            signal.throwIfAborted();
            if (answer === 'allow') {
              this.assertAllowed(name, args);
              return true;
            }
            if (!answer || answer === 'deny') return false;
            if (['strict', 'code', 'auto'].includes(answer)) {
              this.setApproval(answer);
              if (!requiresApproval(this.approval, name, args)) {
                this.assertAllowed(name, args);
                return true;
              }
            }
          }
        } finally {
          this.pending = null;
          ui.state.approvalRequest = null;
          ui.dirty = true;
        }
      } finally {
        waiting.abort();
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }
  definition() {
    return {
      type: 'function',
      function: {
        name: 'execution_mode',
        description:
          'Switch task phase between plan, code and review. Plan/review enforce read-only tools. Cannot override a user-selected read-only mode or change approval settings. Provide a concise reason.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['mode', 'reason'],
          properties: {
            mode: { type: 'string', enum: ['plan', 'code', 'review'] },
            reason: { type: 'string', minLength: 1, maxLength: 240 },
          },
        },
      },
    };
  }
}
module.exports = { LiveControls, requiresApproval, normalizeApproval };
