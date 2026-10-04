'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path');
const { projectPath } = require('../src/services/project-path');
const { inventory, search } = require('../src/services/coding-context');
function createWorkbenchCommands({ ui, cwd, settings, options, saveSettings, dispatch }) {
  const view = (title, text, opts) => (ui.view ? ui.view(title, text, opts) : ui.notice(text));
  async function files(supplied) {
    const root = cwd();
    if (!supplied) {
      const map = await inventory(root, 1800);
      supplied = await ui.choose(
        map.truncated ? 'Project files · partial inventory' : 'Project files',
        map.files.map((file) => ({
          value: file,
          command: file,
          description: path.extname(file).slice(1) || 'file',
        })),
      );
    }
    if (!supplied) return;
    const target = await projectPath(root, supplied.replace(/^"(.*)"$/, '$1')),
      handle = await fs.open(target, 'r');
    let text, truncated;
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('Select a file, not a directory.');
      const bytes = Buffer.alloc(Math.min(stat.size, 128 * 1024)),
        result = await handle.read(bytes, 0, bytes.length, 0);
      if (bytes.subarray(0, result.bytesRead).includes(0))
        throw new Error('Binary file preview is unavailable. Select a text file.');
      text = bytes.subarray(0, result.bytesRead).toString('utf8');
      truncated = stat.size > result.bytesRead;
    } finally {
      await handle.close();
    }
    await view(supplied + (truncated ? ' · first 128 KiB' : ''), text, {
      language: path.extname(target).slice(1),
      lineNumbers: true,
    });
  }
  async function git(value, diffOnly) {
    const service = require('./git-tools').createGitTools(cwd(), AbortSignal.timeout(15000));
    const action =
      value ||
      (await ui.choose('Git', [
        { value: 'status', command: 'Changed files', description: 'Index and worktree status' },
        { value: 'diff', command: 'Working changes', description: 'Unstaged unified diff' },
        { value: 'staged', command: 'Staged changes', description: 'Index unified diff' },
        { value: 'log', command: 'Recent commits', description: 'Read-only history' },
      ]));
    if (!action) return;
    if (action === 'status' && !diffOnly) {
      const status = await service.execute({ action: 'status' });
      if (status.clean) return view('Git status', 'Working tree is clean.');
      const selected = await ui.choose(
        'Changed files',
        status.files.map((file) => ({
          value: file.path,
          command: file.path,
          description: `Index ${file.index} · Worktree ${file.worktree}`,
        })),
      );
      if (selected) {
        const file = status.files.find((file) => file.path === selected);
        if (file.index === '?' && file.worktree === '?') return files(selected);
        const [worktree, staged] = await Promise.all([
          service.execute({ action: 'diff', paths: [selected] }),
          service.execute({ action: 'diff', paths: [selected], staged: true }),
        ]);
        await view(
          selected,
          [
            'WORKTREE',
            worktree.diff || '(No unstaged changes)',
            '\nINDEX',
            staged.diff || '(No staged changes)',
          ].join('\n'),
          { language: 'diff' },
        );
      }
    } else if (action === 'log') {
      const result = await service.execute({ action: 'log', limit: 20 });
      await view(
        'Recent commits',
        result.commits
          .map((c) => `${c.shortHash}  ${c.date.slice(0, 10)}  ${c.subject}`)
          .join('\n') || 'No commits.',
      );
    } else if (['diff', 'staged'].includes(action)) {
      const result = await service.execute({ action: 'diff', staged: action === 'staged' });
      await view(
        action === 'staged' ? 'Staged changes' : 'Working changes',
        (result.diff || 'No changes.') + (result.truncated ? '\n[Preview truncated]' : ''),
        { language: 'diff' },
      );
    } else throw new Error('Use /git status, diff, staged or log.');
  }
  async function handle(text) {
    const match =
      /^\/(commands|files|search|git|diff|doctor|cost|output|agents|output-limit|settings)(?:\s+([\s\S]*))?$/.exec(
        text,
      );
    if (!match) return false;
    const [, name, raw] = match,
      value = (raw || '').trim();
    if (name === 'commands') await ui.commandPalette();
    if (name === 'settings') {
      if (value) return false;
      while (true) {
        const selected = await ui.choose(
          'Settings',
          [
            ['model', 'Model and provider', settings().modelId || 'Not configured'],
            ['runtime', 'Execution limits', 'Retries, deadlines and diagnostics'],
            ['reasoning', 'Reasoning strength', require('../src/reasoning').label(settings())],
            ['budget', 'Task budget', 'USD cap'],
            ['pricing', 'Model pricing', 'Input / output rates'],
            ['output-limit', 'Output limit', 'Tokens per response'],
            ['fallbacks', 'Fallback models', 'Ordered backup chain'],
            ['agents', 'Subagents', options.agents ? 'Enabled' : 'Disabled'],
            ['sandbox', 'Execution environment', settings().sandbox || 'off'],
            ['shell', 'Shell', settings().shell || 'auto'],
            ['hooks', 'Tool hooks', 'User scripts'],
            ['mcp', 'MCP servers', 'Tool integrations'],
            ['plugins', 'Plugins', 'Installed extensions'],
            ['skills', 'Skills', 'Official and imported instructions'],
            ['language', 'Language', settings().language || 'auto'],
            ['shortcuts', 'Keyboard shortcuts', 'View or change keys'],
            ['update', 'CLI updates', 'Check or install official CLI updates'],
          ].map(([value, command, description]) => ({ value, command, description })),
        );
        if (!selected) break;
        if (selected === 'runtime')
          await require('./runtime-menu').configureRuntime('', { ui, settings, saveSettings });
        else await dispatch('/' + selected);
      }
    }
    if (name === 'files') await files(value);
    if (name === 'git' || name === 'diff')
      await git(value || (name === 'diff' ? 'diff' : ''), name === 'diff');
    if (name === 'search') {
      const query = value || (await ui.ask('Search text or pattern:'));
      if (!query) return true;
      let searchOptions = { limit: 100 };
      if (!value) {
        const mode = await ui.choose('Search mode', [
          { value: 'literal', command: 'Literal text', description: 'Case insensitive' },
          { value: 'regex', command: 'Regular expression', description: 'Bounded to one second' },
        ]);
        if (!mode) return true;
        const include = await ui.ask('Include glob (empty means all): e.g. *.{ts,tsx}');
        const exclude = await ui.ask('Exclude glob (empty means none): e.g. *.test.ts');
        searchOptions = {
          ...searchOptions,
          regex: mode === 'regex',
          include: include ? [include] : [],
          exclude: exclude ? [exclude] : [],
        };
      }
      const result = await search(cwd(), query, searchOptions);
      await view(
        `Search · ${result.matches.length} matches${result.truncated ? ' · partial' : ''}`,
        result.matches.map((m) => `${m.path}:${m.line}  ${m.text}`).join('\n') || 'No matches.',
      );
    }
    if (name === 'doctor') {
      const s = settings(),
        probe = await require('./execution-environment')
          .createExecutionEnvironment(s, cwd())
          .probe();
      const lines = [
        `Node: ${process.version}`,
        `Project: ${cwd()}`,
        `Model: ${s.modelId || '(not selected)'}`,
        `Format: ${s.apiFormat || 'openai-chat-completions'}`,
        `Endpoint: ${s.baseUrl || '(not configured)'}`,
        `API key: ${s.apiKey ? 'available' : 'missing (optional for keyless local models)'}`,
        `Execution: ${probe.available ? 'available' : 'unavailable'}`,
        `Boundary: ${probe.boundary}`,
        `Subagents: ${options.agents ? 'enabled' : 'disabled'}`,
      ];
      if (value === 'probe') {
        const result = await require('../src/services/providers').testProvider(s);
        lines.push(`Provider discovery: ${result.ok ? 'passed' : 'failed'} · ${result.message}`);
      }
      await view('Environment diagnostics', lines.join('\n'));
    }
    if (name === 'cost') {
      const cost = ui.state.cost,
        metrics = ui.metrics.snapshot();
      await view(
        'Task usage and budget',
        [
          `Reported tokens: ${metrics.total ?? 'unavailable'}`,
          `Context: ${metrics.used ?? 'unavailable'} / ${metrics.limit}`,
          `Cost USD: ${cost?.costUsd ?? 'unknown'}`,
          `Budget USD: ${cost?.maxCostUsd ?? settings().maxCost ?? 'off'}`,
          `Reserved USD: ${cost?.reservedUsd ?? 0}`,
          `Unpriced calls: ${cost?.unpricedCalls ?? 0}`,
          'Rates are user-configured estimates; provider invoices may differ.',
        ].join('\n'),
      );
    }
    if (name === 'output') {
      const last = ui.state.logs.findLast((block) => block.kind === 'assistant');
      await view('Last response', last?.text || 'No assistant response yet.');
    }
    if (name === 'agents') {
      const chosen =
        value ||
        (await ui.choose('Subagents', [
          {
            value: 'on',
            command: 'Enabled',
            description: 'Read-only researcher and reviewer; shared task budget',
          },
          { value: 'off', command: 'Disabled', description: 'Single agent' },
        ]));
      if (chosen) {
        if (!['on', 'off'].includes(chosen)) throw new Error('Use /agents on or off.');
        options.agents = chosen === 'on';
        saveSettings({ agents: options.agents });
        ui.notice('Subagents: ' + chosen);
      }
    }
    if (name === 'output-limit') {
      const entered =
        value ||
        (await ui.ask(
          `Maximum output tokens including thinking (or auto), current ${settings().maxOutputTokens || 16384}:`,
        ));
      if (entered) {
        if (entered.toLowerCase() === 'auto') {
          saveSettings({ limitsMode: 'auto' });
          ui.notice('Model limits configured automatically');
          return true;
        }
        const tokens = Number(entered);
        const max =
          settings().maxModelOutputTokens ||
          Math.min(2000000, (settings().contextWindow || 32768) - 1);
        if (!Number.isInteger(tokens) || tokens < 1 || tokens > max)
          throw new Error('Output limit must be an integer from 1 to ' + max + '.');
        saveSettings({ maxOutputTokens: tokens });
        ui.notice('Output limit: ' + tokens);
      }
    }
    return true;
  }
  return { handle };
}
module.exports = { createWorkbenchCommands };
