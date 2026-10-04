'use strict';
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../package.json');
const { validVersion } = require('../cli/updates');
const tag = process.env.GITHUB_REF_NAME;
if (manifest.name !== 'achernar-code' || !validVersion(manifest.version) || tag !== `v${manifest.version}`) {
  throw new Error('Release tag must match the standalone achernar-code package version.');
}
if (manifest.main || manifest.dependencies?.electron || manifest.bin?.achernar !== 'cli/index.js') {
  throw new Error('Only the standalone CLI can be published by this workflow.');
}
for (const file of ['main.js', 'preload.js', 'index.html', 'src/renderer.js']) {
  if (fs.existsSync(path.resolve(__dirname, '..', file))) throw new Error('Desktop source is not allowed in the CLI release repository: ' + file);
}
const channel = manifest.version.includes('-') ? 'next' : 'latest';
if (manifest.publishConfig?.tag !== channel) throw new Error('publishConfig.tag does not match the version channel.');
const outputs = { channel, version: manifest.version, tarball: `${manifest.name}-${manifest.version}.tgz` };
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([k, v]) => `${k}=${v}\n`).join(''));
console.log(JSON.stringify(outputs));
