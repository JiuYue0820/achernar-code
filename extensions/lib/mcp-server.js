'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

function createServer(name) {
  const server = new McpServer({ name: `${name}-mcp-server`, version: '1.0.0' });
  return {
    tool(name, description, shape, handler, openWorld = false) {
      server.registerTool(name, { description, inputSchema: z.object(shape).strict(),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: openWorld } },
      async (args, extra) => {
        try {
          const value = await handler(args, extra.signal);
          return { structuredContent: value, content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: error.message }] };
        }
      });
    },
    start() {
      server.connect(new StdioServerTransport()).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
    }
  };
}
module.exports = { createServer, z };
