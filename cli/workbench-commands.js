'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path');
const { projectPath } = require('../src/services/project-path');
const { inventory, search } = require('../src/services/coding-context');
function createWorkbenchCommands({ ui, cwd, settings, options, saveSettings, dispatch }) {
  const t = (text) =>
    require('./i18n').translate(
      ui.state?.language || require('./i18n').resolveLocale(settings().language),
      text,
    );
  const view = (title, text, opts) => (ui.view ? ui.view(title, text, opts) : ui.notice(text));
  async function files(supplied) {
    const root = cwd();
    if (!supplied) {
      const map = await inventory(root, 1800);
      supplied = await ui.choose(
        t(map.truncated ? 'Project files · partial inventory' : 'Project files'),
        map.files.map((file) => ({
          value: file,
          command: file,
          description: path.extname(file).slice(1) || t('file'),
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
    await view(supplied + (truncated ? ' · ' + t('first 128 KiB') : ''), text, {
      language: path.extname(target).slice(1),
      lineNumbers: true,
    });
  }
  async function git(value, diffOnly) {
    const service = require('./git-tools').createGitTools(cwd(), AbortSignal.timeout(15000));
    const action =
      value ||
      (await ui.choose(t('Git'), [
        { value: 'status', command: t('Changed files'), description: t('Index and worktree status') },
        { value: 'diff', command: t('Working changes'), description: t('Unstaged unified diff') },
        { value: 'staged', command: t('Staged changes'), description: t('Index unified diff') },
        { value: 'log', command: t('Recent commits'), description: t('Read-only history') },
      ]));
    if (!action) return;
    if (action === 'status' && !diffOnly) {
      const status = await service.execute({ action: 'status' });
      if (status.clean) return view(t('Git status'), t('Working tree is clean.'));
      const selected = await ui.choose(
        t('Changed files'),
        status.files.map((file) => ({
          value: file.path,
          command: file.path,
          description: t('Index') + ' ' + file.index + ' · ' + t('Worktree') + ' ' + file.worktree,
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
            t('WORKTREE'),
            worktree.diff || t('(No unstaged changes)'),
            '\n' + t('INDEX'),
            staged.diff || t('(No staged changes)'),
          ].join('\n'),
          { language: 'diff' },
        );
      }
    } else if (action === 'log') {
      const result = await service.execute({ action: 'log', limit: 20 });
      await view(
        t('Recent commits'),
        result.commits
          .map((c) => `${c.shortHash}  ${c.date.slice(0, 10)}  ${c.subject}`)
          .join('\n') || t('No commits.'),
      );
    } else if (['diff', 'staged'].includes(action)) {
      const result = await service.execute({ action: 'diff', staged: action === 'staged' });
      await view(
        action === 'staged' ? t('Staged changes') : t('Working changes'),
        (result.diff || t('No changes.')) + (result.truncated ? '\n' + t('[Preview truncated]') : ''),
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
          t('Settings'),
          [
            ['model', t('Model and provider'), settings().modelId || t('Not configured')],
            ['runtime', t('Execution limits'), t('Retries, deadlines and diagnostics')],
            ['reasoning', t('Reasoning strength'), require('../src/reasoning').label(settings())],
            ['budget', t('Task budget'), t('USD cap')],
            ['pricing', t('Model pricing'), t('Input / output rates')],
            ['output-limit', t('Output limit'), t('Tokens per response')],
            ['fallbacks', t('Fallback models'), t('Ordered backup chain')],
            ['agents', t('Subagents'), options.agents ? t('Enabled') : t('Disabled')],
            ['sandbox', t('Execution environment'), settings().sandbox || 'off'],
            ['shell', t('Shell'), settings().shell || 'auto'],
            ['hooks', t('Tool hooks'), t('User scripts')],
            ['mcp', t('MCP servers'), t('Tool integrations')],
            ['plugins', t('Plugins'), t('Installed extensions')],
            ['skills', t('Skills'), t('Official and imported instructions')],
            ['language', t('Language'), settings().language || 'auto'],
            ['shortcuts', t('Keyboard shortcuts'), t('View or change keys')],
            ['update', t('CLI updates'), t('Check or install official CLI updates')],
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
      const query = value || (await ui.ask(t('Search text or pattern:')));
      if (!query) return true;
      let searchOptions = { limit: 100 };
      if (!value) {
        const mode = await ui.choose(t('Search mode'), [
          { value: 'literal', command: t('Literal text'), description: t('Case insensitive') },
          { value: 'regex', command: t('Regular expression'), description: t('Bounded to one second') },
        ]);
        if (!mode) return true;
        const include = await ui.ask(t('Include glob (empty means all): e.g. *.{ts,tsx}'));
        const exclude = await ui.ask(t('Exclude glob (empty means none): e.g. *.test.ts'));
        searchOptions = {
          ...searchOptions,
          regex: mode === 'regex',
          include: include ? [include] : [],
          exclude: exclude ? [exclude] : [],
        };
      }
      const result = await search(cwd(), query, searchOptions);
      await view(
        t('Search') + ` · ${result.matches.length} ${t('matches')}${result.truncated ? ' · ' + t('partial') : ''}`,
        result.matches.map((m) => `${m.path}:${m.line}  ${m.text}`).join('\n') || t('No matches.'),
      );
    }
    if (name === 'doctor') {
      const s = settings(),
        probe = await require('./execution-environment')
          .createExecutionEnvironment(s, cwd())
          .probe();
      const lines = [
        t('Node: ') + process.version,
        t('Project: ') + cwd(),
        t('Model: ') + (s.modelId || t('(not selected)')),
        t('Format: ') + (s.apiFormat || 'openai-chat-completions'),
        t('Endpoint: ') + (s.baseUrl || t('(not configured)')),
        t('API key: ') + (s.apiKey ? t('available') : t('missing (optional for keyless local models)')),
        t('Execution: ') + (probe.available ? t('available') : t('unavailable')),
        t('Boundary: ') + probe.boundary,
        t('Subagents: ') + (options.agents ? t('enabled') : t('disabled')),
      ];
      if (value === 'probe') {
        const result = await require('../src/services/providers').testProvider(s);
        lines.push(t('Provider discovery: ') + (result.ok ? t('passed') : t('failed')) + ' · ' + result.message);
      }
      await view(t('Environment diagnostics'), lines.join('\n'));
    }
    if (name === 'cost') {
      const cost = ui.state.cost,
        metrics = ui.metrics.snapshot();
      await view(
        t('Task usage and budget'),
        [
          t('Reported tokens: ') + (metrics.total ?? t('unavailable')),
          t('Context: ') + (metrics.used ?? t('unavailable')) + ' / ' + metrics.limit,
          t('Cost USD: ') + (cost?.costUsd ?? t('unknown')),
          t('Budget USD: ') + (cost?.maxCostUsd ?? settings().maxCost ?? t('off')),
          t('Reserved USD: ') + (cost?.reservedUsd ?? 0),
          t('Unpriced calls: ') + (cost?.unpricedCalls ?? 0),
          t('Rates are user-configured estimates; provider invoices may differ.'),
        ].join('\n'),
      );
    }
    if (name === 'output') {
      const last = ui.state.logs.findLast((block) => block.kind === 'assistant');
      await view(t('Last response'), last?.text || t('No assistant response yet.'));
    }
    if (name === 'agents') {
      const chosen =
        value ||
        (await ui.choose(t('Subagents'), [
          {
            value: 'on',
            command: t('Enabled'),
            description: t('Read-only researcher and reviewer; shared task budget'),
          },
          { value: 'off', command: t('Disabled'), description: t('Single agent') },
        ]));
      if (chosen) {
        if (!['on', 'off'].includes(chosen)) throw new Error('Use /agents on or off.');
        options.agents = chosen === 'on';
        saveSettings({ agents: options.agents });
        ui.notice(t('Subagents: ') + chosen);
      }
    }
    if (name === 'output-limit') {
      const entered =
        value ||
        (await ui.ask(
          t('Maximum output tokens including thinking (or auto), current ') + (settings().maxOutputTokens || 16384) + ':',
        ));
      if (entered) {
        if (entered.toLowerCase() === 'auto') {
          saveSettings({ limitsMode: 'auto' });
          ui.notice(t('Model limits configured automatically'));
          return true;
        }
        const tokens = Number(entered);
        const max =
          settings().maxModelOutputTokens ||
          Math.min(2000000, (settings().contextWindow || 32768) - 1);
        if (!Number.isInteger(tokens) || tokens < 1 || tokens > max)
          throw new Error('Output limit must be an integer from 1 to ' + max + '.');
        saveSettings({ maxOutputTokens: tokens });
        ui.notice(t('Output limit: ') + tokens);
      }
    }
    return true;
  }
  return { handle };
}
module.exports = { createWorkbenchCommands };
