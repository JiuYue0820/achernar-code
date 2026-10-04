'use strict';

const { createServer, z } = require('../../../lib/mcp-server');
const { fetchPublic } = require('../achernar-web-search/server');
const server = createServer('achernar-package-tools');
const registry = new URL(process.env.ACHERNAR_NPM_REGISTRY || 'https://registry.npmjs.org/');
async function request(relative, signal) {
  signal.throwIfAborted();
  const response = await fetchPublic(new URL(relative, registry), 2 * 1024 * 1024, signal);
  signal.throwIfAborted();
  return JSON.parse(response.body.toString('utf8'));
}
server.tool('npm_search', 'Search published npm packages with pagination. Does not download or execute package code.', {
  query: z.string().min(2).max(200), limit: z.number().int().min(1).max(20).default(5), offset: z.number().int().min(0).max(1000).default(0)
}, async ({ query, limit, offset }, signal) => {
  const params = new URLSearchParams({ text: query, size: String(limit), from: String(offset) });
  const data = await request(`-/v1/search?${params}`, signal);
  const items = (data.objects || []).map(({ package: item }) => ({ name: item.name, version: item.version,
    description: String(item.description || '').slice(0,1000), url: item.links?.npm, repository: item.links?.repository }));
  return { provider: 'npm registry', query, retrievedAt: new Date().toISOString(), total: data.total, items,
    hasMore: offset + items.length < data.total, nextOffset: offset + items.length < data.total ? offset + items.length : null };
}, true);
server.tool('npm_package', 'Read one published npm version, dependencies, license and engines. Does not install packages.', {
  name: z.string().max(214).regex(/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/),
  version: z.string().max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/).default('latest')
}, async ({ name, version }, signal) => {
  const data = await request(`${encodeURIComponent(name)}/${encodeURIComponent(version)}`, signal);
  return { provider: 'npm registry', name: data.name, version: data.version, description: data.description,
    license: data.license, engines: data.engines, dependencies: data.dependencies, repository: data.repository,
    url: `https://www.npmjs.com/package/${name}/v/${data.version}`, retrievedAt: new Date().toISOString() };
}, true);
server.start();
