const test = require('node:test'), assert = require('node:assert/strict');
const { validateCommand, runCommand } = require('../src/services/commands');
test('common broad browser termination forms are refused before execution', () => {
  for (const command of [
    'Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $chrome } | Stop-Process -Force',
    'Get-Process -Name msedge | Stop-Process -Force',
    'Stop-Process -Name firefox -Force',
    'Stop-Process -Name "chrome" -Force',
    'Stop-Process chrome -Force',
    'taskkill /F /IM chrome.exe',
    'taskkill.exe /im "msedge.exe" /t /f',
  ]) assert.throws(() => validateCommand(command, 'win32'), /bulk browser termination/);
  if (process.platform === 'win32') assert.throws(() => runCommand('Stop-Process -Name chrome', process.cwd(), new AbortController().signal), /bulk browser termination/);
});
test('read-only process inspection and scoped helper PID cleanup remain available', () => {
  for (const command of ['Get-Process chrome', 'Stop-Process -Id $proc.Id -Force', 'taskkill /pid 12345 /t /f', 'node --test']) assert.doesNotThrow(() => validateCommand(command, 'win32'));
});
