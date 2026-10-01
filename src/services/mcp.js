const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
async function withMcp(server, action, signal) {
  signal.throwIfAborted();
  const client = new Client({ name: 'Achernar', version: '0.2.0' });
  let transport;
  if (server.url) { const url = new URL(server.url); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('MCP URL 仅支持 HTTP(S)'); transport = new StreamableHTTPClientTransport(url); }
  else {
    if (!server.command || !Array.isArray(server.args || []) || (server.args || []).some(arg => typeof arg !== 'string')) throw new Error('MCP 配置无效');
    const options = { command: server.command, args: server.args || [], stderr: 'pipe' };
    if (server.cwd !== undefined) { if (typeof server.cwd !== 'string' || !server.cwd.trim()) throw new Error('MCP cwd 配置无效'); options.cwd = server.cwd; }
    if (server.env !== undefined) {
      if (!server.env || typeof server.env !== 'object' || Array.isArray(server.env)) throw new Error('MCP env 配置无效');
      options.env = Object.fromEntries(Object.entries(server.env).filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string'));
    }
    transport = new StdioClientTransport(options); transport.stderr?.resume();
  }
  const abort = () => { client.close().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try { await client.connect(transport, { signal, timeout: 30000 }); return await action(client); }
  finally { signal.removeEventListener('abort', abort); await client.close().catch(() => {}); await transport.close().catch(() => {}); }
}
module.exports = { withMcp };
