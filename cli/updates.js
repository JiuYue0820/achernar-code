'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const PACKAGE = 'achernar-code';
const REGISTRY = 'https://registry.npmjs.org';
const validVersion = (value) =>
  typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(value);
function compareVersions(a, b) {
  if (!validVersion(a) || !validVersion(b)) throw new Error('Invalid package version.');
  const parts = (value) => {
    const [core, ...rest] = value.split('-');
    return { core: core.split('.').map(Number), pre: rest.join('-').split('.').filter(Boolean) };
  };
  const left = parts(a),
    right = parts(b);
  for (let i = 0; i < 3; i++)
    if (left.core[i] !== right.core[i]) return Math.sign(left.core[i] - right.core[i]);
  if (!left.pre.length || !right.pre.length)
    return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i],
      y = right.pre[i];
    if (x === y) continue;
    if (x == null || y == null) return x == null ? -1 : 1;
    const nx = /^\d+$/.test(x),
      ny = /^\d+$/.test(y);
    if (nx && ny) return Math.sign(Number(x) - Number(y));
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
async function checkUpdate({ currentVersion, channel = 'latest', fetcher = fetch, signal } = {}) {
  if (!['latest', 'next'].includes(channel))
    throw new Error('Update channel must be latest or next.');
  if (!validVersion(currentVersion)) throw new Error('Invalid installed version.');
  const response = await fetcher(`${REGISTRY}/${PACKAGE}`, {
    signal: signal || AbortSignal.timeout(6000),
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404)
    return { status: 'unpublished', currentVersion, channel, package: PACKAGE };
  if (!response.ok) throw new Error('Update registry returned HTTP ' + response.status);
  const data = await response.json();
  let version = data['dist-tags']?.[channel];
  const stable = data['dist-tags']?.latest;
  // A preview install must still see the stable release when maintainers leave
  // the next tag on the last release candidate.
  if (
    channel === 'next' &&
    validVersion(stable) &&
    !stable.includes('-') &&
    (!validVersion(version) || compareVersions(stable, version) > 0)
  )
    version = stable;
  const entry = data.versions?.[version];
  if (!validVersion(version) || !entry || entry.name !== PACKAGE || entry.version !== version)
    throw new Error('Registry did not return a valid release for this channel.');
  if (channel === 'latest' && version.includes('-'))
    throw new Error('The stable update channel contains a prerelease. Try again later.');
  return {
    status: compareVersions(version, currentVersion) > 0 ? 'available' : 'up_to_date',
    currentVersion,
    version,
    channel,
    package: PACKAGE,
    command: `npm install --global ${PACKAGE}@${version} --registry=${REGISTRY}`,
  };
}
function installUpdate(release, { run = spawn } = {}) {
  if (
    release.status !== 'available' ||
    release.package !== PACKAGE ||
    !validVersion(release.version)
  )
    throw new Error('Check and select an available official release first.');
  const args = [
    'install',
    '--global',
    `${PACKAGE}@${release.version}`,
    `--registry=${REGISTRY}`,
    '--ignore-scripts',
    '--no-fund',
    '--no-audit',
  ];
  return new Promise((resolve, reject) => {
    // Windows npm is a batch shim. All command fragments below are constants
    // except a validated semver; prompts and paths never enter the shell.
    const child =
      process.platform === 'win32'
        ? run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd ' + args.join(' ')], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 180000,
          })
        : run('npm', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
    let output = '';
    const capture = (bytes) => {
      output = (output + bytes).slice(-8000);
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve({ status: 'installed', version: release.version, restartRequired: true })
        : reject(
            Object.assign(new Error('Package update failed. ' + output), {
              code: 'UPDATE_INSTALL_FAILED',
            }),
          ),
    );
  });
}
async function backgroundCheck({ home, manifest, enabled = true, notify, fetcher }) {
  if (!enabled || manifest.name !== PACKAGE) return;
  const file = path.join(home, 'update-check.json');
  try {
    let saved;
    try {
      saved = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {}
    const channel = manifest.version.includes('-') ? 'next' : 'latest';
    if (
      saved?.channel === channel &&
      saved.currentVersion === manifest.version &&
      Date.now() - saved.checkedAt < 86400000
    ) {
      if (saved.status === 'available') notify(saved);
      return;
    }
    const result = await checkUpdate({ currentVersion: manifest.version, channel, fetcher });
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(file, JSON.stringify({ ...result, checkedAt: Date.now() }));
    if (result.status === 'available') notify(result);
  } catch {
    /* Offline startup and an unpublished first release stay usable. */
  }
}
module.exports = {
  PACKAGE,
  REGISTRY,
  validVersion,
  compareVersions,
  checkUpdate,
  installUpdate,
  backgroundCheck,
};
