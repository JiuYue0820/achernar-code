'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const ROOT = fs.realpathSync(process.env.ACHERNAR_PROJECT_ROOT || process.cwd());
const IGNORED_DIRECTORIES = new Set(['.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'release', 'coverage', '.cache', '__pycache__', 'logs']);
const TEXT_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.css', '.csv', '.cjs', '.go', '.h', '.hpp', '.html', '.ini', '.java', '.js', '.json', '.jsx', '.md', '.mjs', '.py', '.rs', '.sh', '.sql', '.svg', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml']);

const tools = [
  {
    name: 'project_overview',
    description: 'Return a bounded inventory of the active Achernar project without reading file contents.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', default: '.', description: 'Relative directory inside the project.' } },
      additionalProperties: false
    }
  },
  {
    name: 'search_project',
    description: 'Search project text files for a literal string and return file, line, and matching text.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 300 },
        path: { type: 'string', default: '.' },
        caseSensitive: { type: 'boolean', default: false },
        maxResults: { type: 'integer', minimum: 1, maximum: 100, default: 30 }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'read_project_file',
    description: 'Read one UTF-8 text file inside the project with a bounded character count.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 1024 },
        maxChars: { type: 'integer', minimum: 1000, maximum: 100000, default: 30000 }
      },
      required: ['path'],
      additionalProperties: false
    }
  }
];

function result(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error) {
  return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
}

function requireRelative(value, fallback = '.') {
  const relative = value === undefined ? fallback : value;
  if (typeof relative !== 'string' || !relative.trim() || relative.length > 1024 || path.isAbsolute(relative)) throw new Error('path must be a relative project path');
  return relative;
}

function resolveInside(relative) {
  const candidate = path.resolve(ROOT, requireRelative(relative));
  const lexicalDifference = path.relative(ROOT, candidate);
  if (lexicalDifference === '..' || lexicalDifference.startsWith(`..${path.sep}`) || path.isAbsolute(lexicalDifference)) throw new Error('path leaves the active project');
  let target;
  try { target = fs.realpathSync(candidate); } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error('path does not exist inside the active project');
    throw error;
  }
  const difference = path.relative(ROOT, target);
  if (difference === '..' || difference.startsWith(`..${path.sep}`) || path.isAbsolute(difference)) throw new Error('path leaves the active project');
  return target;
}

function relativeName(target) {
  return path.relative(ROOT, target).split(path.sep).join('/') || '.';
}

function isReadableText(file, size) {
  return size <= 1024 * 1024 && (TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()) || !path.extname(file));
}

function enumerateFiles(start, maxFiles = 5000) {
  const files = [];
  const stack = [start];
  while (stack.length && files.length < maxFiles) {
    const directory = stack.pop();
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) stack.push(target);
      } else if (entry.isFile()) {
        files.push(target);
        if (files.length >= maxFiles) break;
      }
    }
  }
  return { files, capped: files.length >= maxFiles };
}

function projectOverview(args) {
  const start = resolveInside(args.path);
  if (!fs.statSync(start).isDirectory()) throw new Error('path is not a directory');
  const topLevel = fs.readdirSync(start, { withFileTypes: true })
    .filter(entry => !entry.isSymbolicLink() && !IGNORED_DIRECTORIES.has(entry.name.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 100)
    .map(entry => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' }));
  const { files, capped } = enumerateFiles(start);
  let bytes = 0;
  const extensions = {};
  for (const file of files) {
    const stat = fs.statSync(file);
    bytes += stat.size;
    const extension = path.extname(file).toLowerCase() || '[none]';
    extensions[extension] = (extensions[extension] || 0) + 1;
  }
  return { root: ROOT, path: relativeName(start), fileCount: files.length, totalBytes: bytes, capped, topLevel, commonExtensions: Object.entries(extensions).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([extension, count]) => ({ extension, count })) };
}

function searchProject(args) {
  if (typeof args.query !== 'string' || !args.query.length || args.query.length > 300) throw new Error('query must contain 1 to 300 characters');
  const start = resolveInside(args.path);
  if (!fs.statSync(start).isDirectory()) throw new Error('path is not a directory');
  const maxResults = args.maxResults === undefined ? 30 : args.maxResults;
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100) throw new Error('maxResults must be an integer from 1 to 100');
  const caseSensitive = args.caseSensitive === true;
  const needle = caseSensitive ? args.query : args.query.toLocaleLowerCase();
  const matches = [];
  const { files, capped } = enumerateFiles(start);
  let scannedFiles = 0;
  for (const file of files) {
    const stat = fs.statSync(file);
    if (!isReadableText(file, stat.size)) continue;
    let source;
    try { source = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (source.includes('\0')) continue;
    scannedFiles += 1;
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const haystack = caseSensitive ? lines[index] : lines[index].toLocaleLowerCase();
      if (haystack.includes(needle)) matches.push({ path: relativeName(file), line: index + 1, text: lines[index].trim().slice(0, 500) });
      if (matches.length >= maxResults) return { query: args.query, scannedFiles, capped: true, matches };
    }
  }
  return { query: args.query, scannedFiles, capped, matches };
}

function readProjectFile(args) {
  const file = resolveInside(args.path);
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error('path is not a file');
  if (!isReadableText(file, stat.size)) throw new Error('file is binary or exceeds 1 MB');
  const maxChars = args.maxChars === undefined ? 30000 : args.maxChars;
  if (!Number.isInteger(maxChars) || maxChars < 1000 || maxChars > 100000) throw new Error('maxChars must be an integer from 1000 to 100000');
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes('\0')) throw new Error('file appears to be binary');
  return { path: relativeName(file), bytes: stat.size, truncated: source.length > maxChars, text: source.slice(0, maxChars) };
}

const server = new Server({ name: 'achernar-project-tools', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    const args = request.params.arguments || {};
    if (request.params.name === 'project_overview') return result(projectOverview(args));
    if (request.params.name === 'search_project') return result(searchProject(args));
    if (request.params.name === 'read_project_file') return result(readProjectFile(args));
    throw new Error(`Unknown tool: ${request.params.name}`);
  } catch (error) {
    return errorResult(error);
  }
});

server.connect(new StdioServerTransport()).catch(error => {
  process.stderr.write(`Achernar project tools MCP failed: ${error.message}\n`);
  process.exitCode = 1;
});
