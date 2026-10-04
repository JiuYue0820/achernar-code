const fs = require('node:fs');
require('../../src/services/windows-notifications').createWindowsNotificationSender = () => async value => {
  fs.appendFileSync(process.env.ACHERNAR_NOTIFICATION_TEST_LOG, JSON.stringify(value) + '\n'); return true;
};
