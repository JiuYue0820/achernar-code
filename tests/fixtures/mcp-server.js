const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const server = new Server({ name: 'achernar-test', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'echo', description: 'Echo fixture', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] }));
server.setRequestHandler(CallToolRequestSchema, async request => ({ content: [{ type: 'text', text: request.params.arguments.text }] }));
server.connect(new StdioServerTransport());
