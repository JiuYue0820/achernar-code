'use strict';
const fs = require('node:fs'),
  path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createExtensionLibrary, expandMcpValue } = require('../src/services/extensions');
const { withMcp } = require('../src/services/mcp');
const { isCliExtension } = require('./extension-policy');
function createCliLibrary(appRoot, home) {
  const officialRoot = path.join(appRoot, 'extensions'),
    userRoot = path.join(home, 'extensions');
  const official = createExtensionLibrary(officialRoot),
    user = createExtensionLibrary(userRoot);
  const store = path.join(home, 'integrations.json');
  const read = () =>
    fs.existsSync(store)
      ? JSON.parse(fs.readFileSync(store, 'utf8'))
      : { servers: [], profiles: [] };
  const save = (value) => {
    fs.mkdirSync(home, { recursive: true });
    const temp = store + '.' + randomUUID();
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(temp, store);
  };
  const officialList = () => official.list().filter(isCliExtension);
  const officialIds = () => new Set(officialList().map((e) => e.id));
  const list = () => [
    ...officialList().map((e) => ({ ...e, protected: true })),
    ...user.list().map((e) => ({ ...e, protected: false })),
  ];
  const detail = (id, resource) =>
    officialIds().has(id) ? official.detail(id, resource) : user.detail(id, resource);
  const loadJson = (filename) => {
    const file = path.resolve(filename.replace(/^"(.*)"$/, '$1'));
    if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error('Import file exceeds 2 MB.');
    return { file, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  };
  function validateServer(name, input, base) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Invalid MCP server: ' + name);
    if (input.headers || input.apiKey || input.token)
      throw new Error(
        'Use environment references for MCP credentials; inline tokens and headers are not imported.',
      );
    const server = { id: randomUUID(), name, enabled: false };
    if (input.url) {
      const url = new URL(input.url);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error('MCP URL must be HTTP(S) without credentials or query parameters.');
      server.url = url.href;
    } else {
      if (
        typeof input.command !== 'string' ||
        !input.command.trim() ||
        !Array.isArray(input.args || []) ||
        (input.args || []).some((a) => typeof a !== 'string')
      )
        throw new Error('MCP requires a command and string arguments.');
      server.command = input.command;
      server.args = input.args || [];
      server.cwd = input.cwd ? path.resolve(base, input.cwd) : base;
    }
    if (input.env) {
      if (typeof input.env !== 'object' || Array.isArray(input.env))
        throw new Error('MCP env must be an object.');
      server.env = {};
      for (const [key, value] of Object.entries(input.env)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string')
          throw new Error('Invalid MCP environment entry.');
        if (
          /(?:key|token|secret|password)/i.test(key) &&
          !/^\$\{env:[A-Za-z_][A-Za-z0-9_]*\}$/.test(value)
        )
          throw new Error('Credential ' + key + ' must use ${env:VARIABLE_NAME}.');
        server.env[key] = value;
      }
    }
    return server;
  }
  async function importMcp(filename) {
    const { file, value } = loadJson(filename),
      entries = value.mcpServers || value;
    if (
      !entries ||
      typeof entries !== 'object' ||
      Array.isArray(entries) ||
      Object.keys(entries).length > 100
    )
      throw new Error('Expected an mcpServers object with up to 100 entries.');
    const servers = Object.entries(entries).map(([name, entry]) =>
      validateServer(name, entry, path.dirname(file)),
    );
    const current = read();
    current.servers.push(...servers);
    save(current);
    return servers;
  }
  async function importExtension(directory, kind) {
    fs.mkdirSync(userRoot, { recursive: true });
    const item = await user.importDirectory(directory.replace(/^"(.*)"$/, '$1'), kind);
    if (kind === 'plugins') {
      const file = path.join(userRoot, item.path, '.mcp.json');
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf8')),
          pluginRoot = path.dirname(file),
          current = read();
        const servers = Object.entries(data.mcpServers || {}).map(([name, entry]) => ({
          ...validateServer(
            item.name + ' / ' + name,
            expandMcpValue(entry, { pluginRoot, appRoot }),
            pluginRoot,
          ),
          extensionId: item.id,
        }));
        current.servers.push(...servers);
        save(current);
      }
    }
    return item;
  }
  function servers(project, resolveEnvironment = false, onlyId) {
    const builtin = officialList()
      .filter((e) => e.kind === 'plugins')
      .flatMap((e) => {
        const pluginRoot = path.join(officialRoot, e.path),
          file = path.join(pluginRoot, '.mcp.json');
        if (!fs.existsSync(file)) return [];
        return Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers || {}).map(
          ([name, input]) => ({
            ...expandMcpValue(input, { pluginRoot, appRoot }),
            id: e.id + '/' + name,
            name: e.name,
            enabled: true,
            protected: true,
            extensionId: e.id,
          }),
        );
      });
    const overrides = read();
    return [...builtin, ...overrides.servers].map((server) => {
      const item = { ...server, enabled: overrides.enabled?.[server.id] ?? server.enabled };
      if (resolveEnvironment && item.enabled && (!onlyId || item.id === onlyId)) {
        item.env = { ...item.env, ACHERNAR_PROJECT_ROOT: project };
        for (const [key, value] of Object.entries(item.env))
          item.env[key] = value.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => {
            if (process.env[name] == null) throw new Error('Missing environment variable: ' + name);
            return process.env[name];
          });
        if (item.command === 'node') item.command = process.execPath;
      }
      return item;
    });
  }
  function enable(id, value, project) {
    if (!servers(project).some((s) => s.id === id)) throw new Error('MCP server not found.');
    const state = read();
    state.enabled ||= {};
    state.enabled[id] = Boolean(value);
    save(state);
  }
  async function inspectServer(id, project, signal) {
    const server = servers(project, true, id).find((s) => s.id === id && s.enabled);
    if (!server) throw new Error('Enable this MCP server first.');
    return withMcp(server, (client) => client.listTools({}, { signal, timeout: 20000 }), signal);
  }
  function importModels(filename) {
    const { value } = loadJson(filename),
      items = Array.isArray(value) ? value : value.models || [value];
    if (!Array.isArray(items) || items.length > 200)
      throw new Error('Expected up to 200 model profiles.');
    const normalized = items.map((item) => {
      if (item.apiKey || item.api_key || item.token || item.headers)
        throw new Error('Remove inline credentials and use keyEnv instead.');
      const p = require('../src/services/providers').normalizeProvider({
        ...item,
        modelId: item.modelId || item.model_id || item.model,
        baseUrl: item.baseUrl || item.baseURL || item.base_url,
      });
      if (!p.modelId || /\s/.test(p.modelId))
        throw new Error('Each model profile needs a modelId.');
      if (item.keyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(item.keyEnv))
        throw new Error('Invalid keyEnv name.');
      return {
        name: String(item.name || p.modelId).slice(0, 160),
        modelId: p.modelId,
        baseUrl: p.baseUrl,
        apiFormat: p.apiFormat,
        contextWindow: p.contextWindow,
        ...(p.maxOutputTokens ? { maxOutputTokens: p.maxOutputTokens } : {}),
        ...(p.limitsMode ? { limitsMode: p.limitsMode } : {}),
        ...require('../src/reasoning').normalize(p),
        ...(item.pricing != null
          ? { pricing: require('./model-runtime').validatePricing(item.pricing) }
          : {}),
        ...(item.keyEnv ? { keyEnv: item.keyEnv } : {}),
      };
    });
    const state = read();
    for (const item of normalized) {
      const i = state.profiles.findIndex(
        (p) =>
          p.modelId === item.modelId &&
          p.baseUrl === item.baseUrl &&
          p.apiFormat === item.apiFormat,
      );
      if (i < 0) state.profiles.push(item);
      else state.profiles[i] = item;
    }
    save(state);
    return normalized;
  }
  function saveProfile(profile) {
    const { apiKey: _apiKey, ...safe } = profile,
      data = read();
    const index = data.profiles.findIndex(
      (p) =>
        p.modelId === safe.modelId && p.baseUrl === safe.baseUrl && p.apiFormat === safe.apiFormat,
    );
    if (index < 0) data.profiles.push(safe);
    else data.profiles[index] = safe;
    save(data);
  }
  const sameProfile = (a, b) =>
    a.modelId === b.modelId &&
    a.baseUrl?.replace(/\/+$/, '') === b.baseUrl?.replace(/\/+$/, '') &&
    (a.apiFormat || 'openai-chat-completions') === (b.apiFormat || 'openai-chat-completions');
  function removeProfile(profile) {
    const data = read(),
      index = data.profiles.findIndex((p) => sameProfile(p, profile));
    if (index < 0) throw new Error('Saved model no longer exists. Reopen the model list.');
    data.profiles.splice(index, 1);
    save(data);
  }
  function replaceProfile(previous, profile) {
    const { apiKey: _apiKey, ...safe } = profile,
      data = read(),
      index = data.profiles.findIndex((p) => sameProfile(p, previous));
    if (index < 0) throw new Error('Saved model no longer exists. Reopen the model list.');
    if (data.profiles.some((p, i) => i !== index && sameProfile(p, safe)))
      throw new Error('A model with this endpoint, format and ID already exists.');
    data.profiles[index] = safe;
    save(data);
  }
  return {
    list,
    detail,
    importExtension,
    importMcp,
    servers,
    enable,
    inspectServer,
    importModels,
    saveProfile,
    removeProfile,
    replaceProfile,
    profiles: () => read().profiles,
  };
}
module.exports = { createCliLibrary };
