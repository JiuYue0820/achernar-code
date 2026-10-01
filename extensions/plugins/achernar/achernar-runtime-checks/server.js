'use strict';

const dns = require('node:dns').promises;
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const tools = [
  {
    name: 'runtime_environment',
    description: 'Report the runtime used by this first-party Achernar MCP server.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'inspect_model_directory',
    description: 'Inspect file names and sizes in a local model directory without opening model weights.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 2048 },
        maxDepth: { type: 'integer', minimum: 0, maximum: 3, default: 2 },
        maxEntries: { type: 'integer', minimum: 1, maximum: 500, default: 100 }
      },
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    name: 'inspect_wav',
    description: 'Read RIFF/WAVE metadata and calculate duration without decoding audio samples.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', minLength: 1, maxLength: 2048 } },
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    name: 'probe_openai_endpoint',
    description: 'Probe an OpenAI-compatible /models endpoint without a credential. HTTP 401 or 403 confirms reachability and authentication enforcement.',
    inputSchema: {
      type: 'object',
      properties: { baseUrl: { type: 'string', minLength: 8, maxLength: 2048 } },
      required: ['baseUrl'],
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

function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}

function requireInteger(value, name, fallback, min, max) {
  const number = value === undefined ? fallback : value;
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return number;
}

function inspectModelDirectory(args) {
  const root = fs.realpathSync(requireString(args.path, 'path'));
  if (!fs.statSync(root).isDirectory()) throw new Error('path is not a directory');
  const maxDepth = requireInteger(args.maxDepth, 'maxDepth', 2, 0, 3);
  const maxEntries = requireInteger(args.maxEntries, 'maxEntries', 100, 1, 500);
  const entries = [];
  const stack = [{ directory: root, depth: 0 }];
  while (stack.length && entries.length < maxEntries) {
    const { directory, depth } = stack.pop();
    const children = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child.isSymbolicLink()) continue;
      const target = path.join(directory, child.name);
      const stat = fs.statSync(target);
      entries.push({ path: path.relative(root, target).split(path.sep).join('/'), type: child.isDirectory() ? 'directory' : 'file', bytes: child.isFile() ? stat.size : undefined });
      if (entries.length >= maxEntries) break;
      if (child.isDirectory() && depth < maxDepth) stack.push({ directory: target, depth: depth + 1 });
    }
  }
  return { path: root, entries: entries.reverse(), capped: entries.length >= maxEntries };
}

function inspectWav(args) {
  const file = fs.realpathSync(requireString(args.path, 'path'));
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error('path is not a file');
  if (stat.size < 44 || stat.size > 200 * 1024 * 1024) throw new Error('WAV size must be between 44 bytes and 200 MB');
  const buffer = fs.readFileSync(file);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('file is not a RIFF/WAVE stream');
  let format;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > buffer.length) throw new Error(`invalid WAV chunk: ${id}`);
    if (id === 'fmt ' && size >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        byteRate: buffer.readUInt32LE(start + 8),
        blockAlign: buffer.readUInt16LE(start + 12),
        bitsPerSample: buffer.readUInt16LE(start + 14)
      };
    }
    if (id === 'data') dataBytes += size;
    offset = start + size + (size % 2);
  }
  if (!format || !dataBytes || !format.byteRate) throw new Error('WAV is missing fmt or data chunks');
  return { path: file, fileBytes: stat.size, dataBytes, durationSeconds: Number((dataBytes / format.byteRate).toFixed(3)), ...format };
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0);
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase();
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value) || (mapped ? isPrivateAddress(mapped[1]) : false);
  }
  return true;
}

async function publicEndpoint(baseUrl) {
  const base = new URL(requireString(baseUrl, 'baseUrl').replace(/\/?$/, '/'));
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('baseUrl must be HTTP(S) without embedded credentials');
  const hostname = base.hostname.toLowerCase().replace(/\.$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) throw new Error('local network endpoints are not allowed');
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || (process.env.ACHERNAR_ALLOW_PRIVATE_NETWORK !== '1' && addresses.some(({ address }) => isPrivateAddress(address)))) throw new Error('private or reserved network endpoints are not allowed');
  return new URL('models', base);
}

async function probeEndpoint(args) {
  const endpoint = await publicEndpoint(args.baseUrl);
  const response = await fetch(endpoint, { method: 'GET', redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': 'Achernar-Runtime-Checks/1.0' }, signal: AbortSignal.timeout(15000) });
  const body = (await response.text()).slice(0, 4096);
  let error;
  try {
    const parsed = JSON.parse(body);
    const source = parsed.error || parsed;
    error = source && typeof source === 'object' ? { type: source.type, code: source.code, message: typeof source.message === 'string' ? source.message.slice(0, 300) : undefined } : undefined;
  } catch {}
  return { endpoint: endpoint.toString(), reachable: true, status: response.status, authenticationRequired: response.status === 401 || response.status === 403, mediaType: (response.headers.get('content-type') || '').split(';')[0], error };
}

const server = new Server({ name: 'achernar-runtime-checks', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    const args = request.params.arguments || {};
    if (request.params.name === 'runtime_environment') return result({ node: process.version, platform: process.platform, arch: process.arch, plugin: 'achernar-runtime-checks', version: '1.0.0' });
    if (request.params.name === 'inspect_model_directory') return result(inspectModelDirectory(args));
    if (request.params.name === 'inspect_wav') return result(inspectWav(args));
    if (request.params.name === 'probe_openai_endpoint') return result(await probeEndpoint(args));
    throw new Error(`Unknown tool: ${request.params.name}`);
  } catch (error) {
    return errorResult(error);
  }
});

server.connect(new StdioServerTransport()).catch(error => {
  process.stderr.write(`Achernar runtime checks MCP failed: ${error.message}\n`);
  process.exitCode = 1;
});
