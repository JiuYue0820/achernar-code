'use strict';
function createIntegrationCommands({ ui, library, cwd, settings, saveSettings, refresh }) {
  const choose = (title, entries) =>
    ui.choose(
      title,
      entries.map(([value, description, command]) => ({
        value,
        command: command || value,
        description,
      })),
    );
  const importFile = async (kind, supplied) => {
    const filename =
      supplied ||
      (await ui.ask(
        `Path to ${kind === 'skills' || kind === 'plugins' ? kind + ' directory' : kind + ' JSON file'} (Esc to cancel):`,
      ));
    if (!filename.trim()) return;
    const target = require('node:path').resolve(cwd(), filename.trim().replace(/^"(.*)"$/, '$1'));
    if (kind === 'skills' || kind === 'plugins') {
      const item = await library.importExtension(target, kind);
      ui.notice('Imported ' + item.name + '. Plugin MCP servers start disabled.');
      ui.catalog = require('./tui').commandCatalog(library.list());
    } else if (kind === 'mcp') {
      const servers = await library.importMcp(target);
      ui.notice(
        `Imported ${servers.length} MCP servers (disabled). Use /mcp to review and enable.`,
      );
    } else {
      const profiles = library.importModels(target);
      ui.notice(
        `Imported ${profiles.length} model profiles. Use /model to select a saved profile.`,
      );
    }
  };
  async function handle(text) {
    const match = /^\/(import|mcp|skills|plugins|model)(?:\s+([\s\S]*))?$/.exec(text);
    if (!match) return false;
    const command = match[1],
      argument = (match[2] || '').trim();
    if (command === 'model') {
      if (argument === 'edit' || argument === 'add') {
        const draft = await require('./model-wizard').modelWizard(
          ui,
          settings(),
          argument === 'edit',
        );
        if (!draft) return true;
        saveSettings(draft);
        const current = settings();
        library.saveProfile({
          name: draft.name,
          providerName: draft.providerName,
          modelId: current.modelId,
          baseUrl: current.baseUrl,
          apiFormat: current.apiFormat,
          contextWindow: current.contextWindow,
          credentialId: current.credentialId || null,
          ...require('../src/reasoning').normalize(current),
        });
        refresh();
        ui.notice(
          'Model configuration saved. Use /reasoning to select or customize reasoning strength.',
        );
        return true;
      }
      if (/^import(?:\s|$)/.test(argument)) {
        await importFile('models', argument.slice(6).trim());
        return true;
      }
      return false;
    }
    if (command === 'import') {
      const parts = /^(models|mcp|skills|plugins)(?:\s+([\s\S]*))?$/.exec(argument);
      const kind =
        parts?.[1] ||
        (await choose('Import', [
          ['models', 'Model profiles from JSON'],
          ['mcp', 'MCP server configuration'],
          ['skills', 'Directory containing SKILL.md'],
          ['plugins', 'Directory containing README.md and optional .mcp.json'],
        ]));
      if (kind) await importFile(kind, parts?.[2]);
      return true;
    }
    if (/^import(?:\s|$)/.test(argument)) {
      await importFile(command, argument.slice(6).trim());
      return true;
    }
    if (command === 'mcp') {
      const servers = library.servers(cwd()),
        id = await choose('MCP servers', [
          ['@import', 'Import a configuration file', '+ Import MCP'],
          ...servers.map((s) => [
            s.id,
            (s.enabled ? 'Enabled' : 'Disabled') + (s.protected ? ' · Official' : ''),
            s.name,
          ]),
        ]);
      if (id === '@import') await importFile('mcp');
      else if (id) {
        const server = servers.find((s) => s.id === id);
        const action = await choose(server.name, [
          ['toggle', server.enabled ? 'Disable this server' : 'Enable this server'],
          ['tools', 'Connect and list tools'],
          ['config', 'Show connection details'],
        ]);
        if (action === 'toggle') {
          if (
            !server.enabled &&
            !/^y(?:es)?$/i.test(
              await ui.ask(
                `Enable ${server.name}?\n${server.url || [server.command, ...(server.args || [])].join(' ')}\nConnecting can start this program or contact this server. [y/N]`,
              ),
            )
          )
            return true;
          library.enable(id, !server.enabled, cwd());
          ui.notice(server.name + (server.enabled ? ' disabled.' : ' enabled.'));
        } else if (action === 'tools') {
          if (!server.enabled) throw new Error('Enable this MCP server before connecting.');
          if (
            !/^y(?:es)?$/i.test(
              await ui.ask(
                `Connect to ${server.name} and list its tools? This can start its configured process. [y/N]`,
              ),
            )
          )
            return true;
          const tools = await library.inspectServer(id, cwd(), AbortSignal.timeout(20000));
          ui.notice(
            tools.tools.map((t) => t.name + ' · ' + (t.description || '')).join('\n') ||
              'No tools reported.',
          );
        } else if (action === 'config')
          ui.notice(
            JSON.stringify(
              {
                name: server.name,
                enabled: server.enabled,
                command: server.command,
                args: server.args,
                url: server.url,
                cwd: server.cwd,
                environmentVariables: Object.keys(server.env || {}),
              },
              null,
              2,
            ),
          );
      }
      return true;
    }
    const items = library.list().filter((e) => e.kind === command);
    const id = await choose(command === 'skills' ? 'Skills library' : 'Plugin library', [
      ['@import', 'Import from a local directory', '+ Import ' + command],
      ...items.map((item) => [
        item.id,
        item.protected ? 'Official / bundled · preserved' : 'Imported',
        item.name,
      ]),
    ]);
    if (id === '@import') await importFile(command);
    else if (id) {
      const item = items.find((e) => e.id === id),
        choice = await choose(item.name, [
          ['use', 'Insert this extension into your next task'],
          ['read', 'Read its instructions'],
          ...(command === 'plugins' ? [['mcp', 'Manage plugin MCP connections']] : []),
        ]);
      if (choice === 'read') ui.notice(library.detail(id).content);
      else if (choice === 'use') {
        const entry = ui.catalog.find((e) => e.id === id);
        if (entry) ui.editor.set(entry.command + ' ');
      } else if (choice === 'mcp') await handle('/mcp');
    }
    return true;
  }
  return { handle };
}
module.exports = { createIntegrationCommands };
