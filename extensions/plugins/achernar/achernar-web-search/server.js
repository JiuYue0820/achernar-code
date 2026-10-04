'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const SEARCH_ENDPOINT = process.env.ACHERNAR_SEARCH_ENDPOINT || 'https://www.bing.com/search';
const USER_AGENT = 'Achernar-Web-Search/1.0';
const { searchWeb } = require('./search');

const tools = [
  {
    name: 'web_search',
    description: 'Search the public web and return traceable titles, URLs, snippets, and retrieval time.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 2, maxLength: 500, description: 'Search query. Search operators such as site: are supported.' },
        count: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
        provider: { type: 'string', enum: ['auto', 'bing', '360'], default: 'auto', description: 'Automatic Bing-to-360 fallback, or select one source.' },
        market: { type: 'string', pattern: '^[a-z]{2}-[A-Z]{2}$', default: 'zh-CN' }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'fetch_webpage',
    description: 'Read a public HTTP(S) page and return its final URL, title, media type, and cleaned text.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', minLength: 8, maxLength: 2048 },
        maxChars: { type: 'integer', minimum: 1000, maximum: 50000, default: 12000 }
      },
      required: ['url'],
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

function requireString(value, name, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
    throw new Error(`${name} must be a string between ${min} and ${max} characters`);
  }
  return value.trim();
}

function requireInteger(value, name, fallback, min, max) {
  const number = value === undefined ? fallback : value;
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return number;
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0);
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)) return true;
    const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  return true;
}

async function assertPublicUrl(value) {
  const url = value instanceof URL ? value : new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) URLs are allowed');
  if (url.username || url.password) throw new Error('Credentials in URLs are not allowed');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Local network URLs are not allowed');
  }
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || (process.env.ACHERNAR_ALLOW_PRIVATE_NETWORK !== '1' && addresses.some(({ address }) => isPrivateAddress(address)))) throw new Error('Private or reserved network addresses are not allowed');
  return url;
}

async function readLimited(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes`);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes`);
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return Buffer.concat(chunks, size);
}

async function fetchPublic(rawUrl, maxBytes, signal) {
  const timeout = AbortSignal.timeout(12000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let current = new URL(rawUrl);
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    requestSignal.throwIfAborted();
    await assertPublicUrl(current);
    const response = await fetch(current, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/xml,text/plain,application/json;q=0.9,*/*;q=0.2' },
      redirect: 'manual',
      signal: requestSignal
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      if (redirects === 4) throw new Error('Too many redirects');
      await response.body?.cancel();
      current = new URL(response.headers.get('location'), current);
      continue;
    }
    const body = await readLimited(response, maxBytes);
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${current.hostname}`);
    return { response, body, url: current.toString() };
  }
  throw new Error('Too many redirects');
}

function normalizedText(value) {
  return String(value || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function extractPage(body, contentType, finalUrl, maxChars) {
  const raw = body.toString('utf8');
  let title = '';
  let text = raw;
  if (/html|xhtml/i.test(contentType)) {
    const { DOMParser } = await import('linkedom');
    const document = new DOMParser().parseFromString(raw, 'text/html');
    for (const node of document.querySelectorAll('script,style,noscript,svg,template,form,nav,footer')) node.remove();
    title = normalizedText(document.querySelector('title')?.textContent);
    const main = document.querySelector('main,article,[role="main"]') || document.querySelector('body') || document.body;
    const blocks = main ? [...main.querySelectorAll('h1,h2,h3,p,li,pre,blockquote,td,th')].map(node => normalizedText(node.textContent)).filter(Boolean) : [];
    text = blocks.length ? blocks.join('\n') : normalizedText(main?.textContent || '');
  } else if (/json/i.test(contentType)) {
    try { text = JSON.stringify(JSON.parse(raw), null, 2); } catch { text = raw; }
  }
  text = normalizedText(text);
  return {
    url: finalUrl,
    title: title || new URL(finalUrl).hostname,
    mediaType: contentType.split(';')[0] || 'application/octet-stream',
    retrievedAt: new Date().toISOString(),
    truncated: text.length > maxChars,
    text: text.slice(0, maxChars)
  };
}

async function fetchWebpage(args) {
  const url = requireString(args.url, 'url', 8, 2048);
  const maxChars = requireInteger(args.maxChars, 'maxChars', 12000, 1000, 50000);
  const { response, body, url: finalUrl } = await fetchPublic(url, 3 * 1024 * 1024);
  return extractPage(body, response.headers.get('content-type') || '', finalUrl, maxChars);
}

const server = new Server({ name: 'achernar-web-search', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  try {
    const args = request.params.arguments || {};
    if (request.params.name === 'web_search') return result(await searchWeb(args, (url, limit) => fetchPublic(url, limit, extra.signal), SEARCH_ENDPOINT, process.env.ACHERNAR_SEARCH_FALLBACK_ENDPOINT || 'https://www.so.com/s'));
    if (request.params.name === 'fetch_webpage') return result(await fetchWebpage(args));
    throw new Error(`Unknown tool: ${request.params.name}`);
  } catch (error) {
    return errorResult(error);
  }
});

if (require.main === module) server.connect(new StdioServerTransport()).catch(error => {
  process.stderr.write(`Achernar web search MCP failed: ${error.message}\n`);
  process.exitCode = 1;
});
module.exports = { fetchPublic };
