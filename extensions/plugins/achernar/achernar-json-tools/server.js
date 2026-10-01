'use strict';

const { createServer, z } = require('../../../lib/mcp-server');
const server = createServer('achernar-json-tools');
const json = z.string().min(1).max(200000).describe('Literal JSON data; never evaluated as code.');

server.tool('json_inspect', 'Parse JSON and select a value by RFC 6901 JSON Pointer. Returns type, keys and bounded value.', {
  json, pointer: z.string().max(2000).default(''), maxChars: z.number().int().min(100).max(30000).default(10000)
}, ({ json, pointer, maxChars }) => {
  let value = JSON.parse(json);
  if (pointer && !pointer.startsWith('/')) throw new Error('JSON Pointer must be empty or start with /');
  for (const part of pointer ? pointer.slice(1).split('/') : []) {
    if (/~(?:[^01]|$)/.test(part)) throw new Error('Invalid JSON Pointer escape');
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key) || (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key))) throw new Error('JSON Pointer does not exist');
    value = value[key];
  }
  const serialized = JSON.stringify(value, null, 2);
  return { pointer, type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    ...(value !== null && typeof value === 'object' ? { count: Object.keys(value).length, keys: Object.keys(value).slice(0,100) } : {}),
    truncated: serialized.length > maxChars,
    ...(serialized.length > maxChars ? { preview: serialized.slice(0,maxChars) } : { value }) };
});
server.tool('json_format', 'Validate and format JSON. Returns text only; does not overwrite files.', {
  json, indent: z.number().int().min(0).max(4).default(2)
}, ({ json, indent }) => {
  const formatted = JSON.stringify(JSON.parse(json), null, indent);
  if (formatted.length > 30000) throw new Error('Formatted JSON exceeds 30000 characters; select a smaller value with json_inspect');
  return { valid: true, formatted };
});
server.start();
