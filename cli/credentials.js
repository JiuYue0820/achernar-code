'use strict';
const fs = require('node:fs'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
function createCredentialStore(home) {
  const file = path.join(home, 'credentials.json'),
    cache = new Map();
  const load = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
  function crypt(input, decrypt) {
    if (process.platform !== 'win32')
      throw new Error(
        'Encrypted API key storage currently requires Windows. Use an API key environment variable on this platform.',
      );
    const script =
      'Add-Type -AssemblyName System.Security; $value = [Console]::In.ReadToEnd(); ' +
      (decrypt
        ? '$bytes = [Convert]::FromBase64String($value); $plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain));'
        : '$bytes = [Text.Encoding]::UTF8.GetBytes($value); $sealed = [Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($sealed));');
    try {
      return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        input,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 65536,
      }).trim();
    } catch {
      throw new Error('Windows credential encryption failed. No API key was written in plaintext.');
    }
  }
  function set(endpoint, format, key) {
    if (typeof key !== 'string' || !key.trim() || key.length > 16000 || /[\r\n]/.test(key))
      throw new Error('Enter a valid single-line API key.');
    const id = createHash('sha256')
        .update(endpoint + '\n' + format)
        .digest('hex'),
      data = load();
    data[id] = { scheme: 'windows-dpapi-current-user', value: crypt(key.trim(), false) };
    fs.mkdirSync(home, { recursive: true });
    const temp = file + '.' + randomUUID();
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
    cache.set(id, key.trim());
    return id;
  }
  function get(id) {
    if (!id) return '';
    if (cache.has(id)) return cache.get(id);
    const value = load()[id];
    if (!value) return '';
    if (value.scheme !== 'windows-dpapi-current-user')
      throw new Error('Unsupported credential storage format.');
    const key = crypt(value.value, true);
    cache.set(id, key);
    return key;
  }
  return { set, get };
}
module.exports = { createCredentialStore };
