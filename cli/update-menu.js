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
  const t = (text) =>
    require('./i18n').translate(
      ui.state?.language || require('./i18n').resolveLocale(settings().language),
      text,
    );
  const action =
    value ||
    (await ui.choose(t('CLI updates'), [
      {
        value: 'check',
        command: t('Check for updates'),
        description: t('Official npm package; stable or preview channel'),
      },
      {
        value: 'toggle',
        command: t('Update notifications'),
        description: settings().updateNotifications === false ? t('Disabled') : t('Enabled'),
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
    ui.notice(t('The CLI has not been published to npm yet.'));
    return;
  }
  if (release.status === 'up_to_date') {
    ui.notice(t('The CLI is up to date.'));
    return;
  }
  ui.notice(t('CLI update available: ') + release.version);
  const selected = await ui.choose(t('Install CLI update?'), [
    { value: 'later', command: t('Later'), description: release.command },
    {
      value: 'install',
      command: t('Install update'),
      description: release.version + ' · npm · ' + t('restart required'),
    },
  ]);
  if (selected !== 'install') return;
  if (isRunning()) throw new Error('Stop the running task before installing an update.');
  if (manifest.name !== require('./updates').PACKAGE) {
    ui.notice(
      t(
        'This is a development checkout. Install the released CLI in a separate environment to avoid replacing this launcher.',
      ),
    );
    return;
  }
  await install(release);
  ui.notice(t('CLI update installed. Restart Achernar to use it.'));
}
module.exports = { configureUpdates };
