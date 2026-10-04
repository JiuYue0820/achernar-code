'use strict';
const fs = require('node:fs'),
  path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { projectPath } = require('../src/services/project-path');
const { definition, enumeration, string } = require('../src/services/core-tools');
const actions = ['symbols', 'definition', 'references', 'hover', 'diagnostics'];
const toolDefinition = definition(
  'lsp',
  'Read-only TypeScript/JavaScript code intelligence: symbols, definition, references, hover/types and compiler diagnostics. Use before cross-file edits. Positions are 1-based lines and UTF-16 columns in the current on-disk file. Does not apply edits. Other languages use files.search.',
  {
    action: enumeration(actions.join(' ')),
    path: string('Project-relative JS/TS/JSX/TSX file'),
    line: { type: 'integer', minimum: 1 },
    column: { type: 'integer', minimum: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
  ['action', 'path'],
);
const validate = new (require('ajv'))().compile(toolDefinition.function.parameters);
function languageStatus() {
  return {
    enabled: true,
    languages: ['typescript', 'javascript', 'tsx', 'jsx'],
    server: 'typescript-language-server',
    version: require('typescript-language-server/package.json').version,
    typescript: require('typescript/package.json').version,
    actions,
    indexing: 'on demand; no project plugins or automatic type downloads',
    positions: '1-based UTF-16',
  };
}
function createLanguageTools(root, { signal = new AbortController().signal } = {}) {
  // macOS /var aliases and Windows short-name/junction paths must use the
  // same canonical root as projectPath and the server's document locations.
  root = fs.realpathSync.native(root);
  let client, ready;
  const opened = new Map();
  async function start() {
    if (ready) return ready;
    ready = (async () => {
      const { LspClient } = require('./lsp-client');
      const server = path.join(
        path.dirname(require.resolve('typescript-language-server/package.json')),
        'lib/cli.mjs',
      );
      const tsserver = require.resolve('typescript/lib/tsserver.js');
      // Do not inherit API keys, NODE_OPTIONS, or project-selected executables.
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          /^(?:SystemRoot|WINDIR|PATH|PATHEXT|HOME|USERPROFILE|TEMP|TMP|TMPDIR|LANG)$/i.test(key),
        ),
      );
      client = new LspClient(process.execPath, [server, '--stdio', '--log-level', '1'], {
        cwd: root,
        env,
        signal,
      });
      await client.request('initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(root).href,
        workspaceFolders: [{ uri: pathToFileURL(root).href, name: path.basename(root) }],
        capabilities: {
          textDocument: {
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            hover: { contentFormat: ['plaintext'] },
          },
          workspace: { configuration: true },
        },
        initializationOptions: {
          hostInfo: 'Achernar Code',
          plugins: [],
          disableAutomaticTypingAcquisition: true,
          maxTsServerMemory: 512,
          tsserver: { path: tsserver, useSyntaxServer: 'never' },
        },
      });
      client.notify('initialized', {});
      return client;
    })();
    return ready;
  }
  async function location(uri, range) {
    if (!uri?.startsWith('file:') || !range?.start) return null;
    try {
      const target = fileURLToPath(uri);
      await projectPath(root, target);
      return {
        path: path.relative(root, target).split(path.sep).join('/'),
        line: range.start.line + 1,
        column: range.start.character + 1,
        endLine: range.end.line + 1,
        endColumn: range.end.character + 1,
      };
    } catch {
      return null;
    } // Never return paths outside the admitted project.
  }
  async function execute(args) {
    signal.throwIfAborted();
    if (!validate(args)) throw new Error('Invalid lsp arguments');
    const file = await projectPath(root, args.path);
    const ext = path.extname(file).toLowerCase();
    if (!['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'].includes(ext))
      throw new Error(
        'Built-in LSP supports JavaScript and TypeScript. Use files.search for other languages.',
      );
    if ((await fs.promises.stat(file)).size > 1024 * 1024)
      throw new Error('Language tools accept files up to 1 MB');
    const content = await fs.promises.readFile(file, 'utf8'),
      lines = content.split(/\r?\n/),
      uri = pathToFileURL(file).href;
    const c = await start();
    const previous = opened.get(uri),
      version = (previous?.version || 0) + 1;
    if (!previous)
      c.notify('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: ['.ts', '.mts', '.cts', '.tsx'].includes(ext)
            ? ext === '.tsx'
              ? 'typescriptreact'
              : 'typescript'
            : ext === '.jsx'
              ? 'javascriptreact'
              : 'javascript',
          version,
          text: content,
        },
      });
    else if (content !== previous.content)
      c.notify('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text: content }],
      });
    opened.set(uri, { version, content });
    // Ensure previously opened imports are not stale after files.write or terminal edits.
    for (const [otherUri, entry] of opened) {
      if (uri === otherUri) continue;
      try {
        const other = fileURLToPath(otherUri);
        await projectPath(root, other);
        if ((await fs.promises.stat(other)).size > 1024 * 1024) throw new Error('Too large');
        const text = await fs.promises.readFile(other, 'utf8');
        if (text !== entry.content) {
          c.notify('textDocument/didChange', {
            textDocument: { uri: otherUri, version: ++entry.version },
            contentChanges: [{ text }],
          });
          entry.content = text;
        }
      } catch {
        c.notify('textDocument/didClose', { textDocument: { uri: otherUri } });
        opened.delete(otherUri);
      }
    }
    const limit = args.limit || 40,
      params = { textDocument: { uri } };
    if (['definition', 'references', 'hover'].includes(args.action)) {
      if (
        !args.line ||
        !args.column ||
        args.line > lines.length ||
        args.column > lines[args.line - 1].length + 1
      )
        throw new Error('Provide a valid 1-based line and UTF-16 column');
      params.position = { line: args.line - 1, character: args.column - 1 };
    }
    if (args.action === 'diagnostics') {
      // The server exposes synchronized tsserver diagnostics through its documented command.
      // Only these two read-only requests are allowed; no general executeCommand tool exists.
      const found = [];
      for (const command of ['syntacticDiagnosticsSync', 'semanticDiagnosticsSync']) {
        const result = await c.request('workspace/executeCommand', {
          command: 'typescript.tsserverRequest',
          arguments: [command, { file, includeLinePosition: true }, { expectsResult: true }],
        });
        if (!result || !Array.isArray(result.body))
          throw new Error('Language server did not return complete compiler diagnostics');
        for (const d of result.body)
          found.push({
            code: d.code,
            severity: d.category,
            message:
              typeof (d.message ?? d.text) === 'string'
                ? (d.message ?? d.text)
                : JSON.stringify(d.message ?? d.text),
            line: d.start?.line || d.startLocation?.line,
            column: d.start?.offset || d.startLocation?.offset,
          });
      }
      return {
        path: args.path,
        diagnostics: found.slice(0, limit),
        truncated: found.length > limit,
        complete: true,
        source: 'TypeScript compiler via LSP',
      };
    }
    if (args.action === 'hover') {
      const result = await c.request('textDocument/hover', params);
      return { path: args.path, contents: result?.contents || null };
    }
    const result = await c.request(
      args.action === 'symbols' ? 'textDocument/documentSymbol' : `textDocument/${args.action}`,
      {
        ...params,
        ...(args.action === 'references' ? { context: { includeDeclaration: true } } : {}),
      },
    );
    const items = [];
    async function collect(values, parent) {
      for (const item of values || []) {
        const loc = await location(
          item.location?.uri || item.targetUri || item.uri || uri,
          item.location?.range || item.targetSelectionRange || item.selectionRange || item.range,
        );
        if (loc)
          items.push({
            ...loc,
            ...(item.name ? { name: item.name, kind: item.kind, parent } : {}),
          });
        if (item.children) await collect(item.children, item.name);
      }
    }
    await collect(Array.isArray(result) ? result : result ? [result] : []);
    return {
      path: args.path,
      items: items.slice(0, limit),
      truncated: items.length > limit,
      source: 'LSP',
      excludedExternalLocations: true,
    };
  }
  return { definition: toolDefinition, execute, close: () => client?.close() };
}
module.exports = { createLanguageTools, languageStatus, actions, toolDefinition };
