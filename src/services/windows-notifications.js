'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');

// A short-lived hidden helper uses Windows' built-in WinRT toast API. No shell
// interpolation, Electron install or third-party notification daemon is needed.
function createWindowsNotificationSender({ appId = 'Achernar.Code', platform = process.platform, spawnProcess = spawn, timeoutMs = 8000 } = {}) {
  if (!['Achernar.Code', 'Achernar.Desktop'].includes(appId)) throw new Error('Unknown notification application');
  const invoke = (action, payload = {}) => {
    if (platform !== 'win32' || process.env.ACHERNAR_NOTIFICATIONS === '0' || payload.signal?.aborted) return Promise.resolve(false);
    return new Promise(resolve => {
      let child, timer, settled = false;
      const cancel = () => { child?.kill(); finish(false); };
      const finish = value => { if (settled) return; settled = true; clearTimeout(timer); payload.signal?.removeEventListener('abort', cancel); resolve(value); };
      try {
        const executable = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        child = spawnProcess(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'windows-notifications.ps1'), '-Action', action, '-AppId', appId], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', chunk => { if (output.length < 4096) output += chunk.toString('utf8'); });
        child.stderr.resume(); // Never contaminate the TUI or --json envelope.
        child.once('error', () => finish(false));
        child.once('close', code => finish(code === 0 && output.trim() === 'ok'));
        child.stdin.on('error', () => {});
        timer = setTimeout(() => { child.kill(); finish(false); }, timeoutMs);
        payload.signal?.addEventListener('abort', cancel, { once: true });
        child.stdin.end(JSON.stringify({ title: String(payload.title || '').slice(0, 160), body: String(payload.body || '').slice(0, 400) }));
      } catch { child?.kill(); finish(false); }
    });
  };
  const send = payload => invoke('show', payload);
  send.register = () => invoke('register');
  return send;
}
module.exports = { createWindowsNotificationSender };
