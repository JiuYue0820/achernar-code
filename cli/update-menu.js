'use strict';
async function configureUpdates(
  value,
  {
    ui,
    settings,
    saveSettings,
    manifest,
    isRunning = () => false,
    check = require('./updates').checkUpdate,
    install = require('./updates').installUpdate,
  },
) {
  const action =
    value ||
    (await ui.choose('CLI updates', [
      {
        value: 'check',
        command: 'Check for updates',
        description: 'Official npm package; stable or preview channel',
      },
      {
        value: 'toggle',
        command: 'Update notifications',
        description: settings().updateNotifications === false ? 'Disabled' : 'Enabled',
      },
    ]));
  if (!action) return;
  if (action === 'toggle') {
    saveSettings({ updateNotifications: settings().updateNotifications === false });
    return;
  }
  if (!['check', 'install'].includes(action))
    throw new Error('Use /update check or /update install.');
  const currentVersion = manifest.version,
    channel = currentVersion.includes('-') ? 'next' : 'latest';
  const release = await check({ currentVersion, channel });
  if (release.status === 'unpublished') {
    ui.notice('The CLI has not been published to npm yet.');
    return;
  }
  if (release.status === 'up_to_date') {
    ui.notice('The CLI is up to date.');
    return;
  }
  ui.notice('CLI update available: ' + release.version);
  const selected = await ui.choose('Install CLI update?', [
    { value: 'later', command: 'Later', description: release.command },
    {
      value: 'install',
      command: 'Install update',
      description: release.version + ' · npm · restart required',
    },
  ]);
  if (selected !== 'install') return;
  if (isRunning()) throw new Error('Stop the running task before installing an update.');
  if (manifest.name !== require('./updates').PACKAGE) {
    ui.notice(
      'This is a development checkout. Install the released CLI in a separate environment to avoid replacing this launcher.',
    );
    return;
  }
  await install(release);
  ui.notice('CLI update installed. Restart Achernar to use it.');
}
module.exports = { configureUpdates };
