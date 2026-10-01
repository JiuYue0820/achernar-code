'use strict';
const { spawn } = require('node:child_process');
async function copyText(text) {
  // Content travels over stdin, never through a shell command or process args.
  const choices =
    process.platform === 'win32'
      ? [
          [
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); Set-Clipboard -Value ([Console]::In.ReadToEnd())',
            ],
          ],
        ]
      : process.platform === 'darwin'
        ? [['pbcopy', []]]
        : [
            ['wl-copy', []],
            ['xclip', ['-selection', 'clipboard']],
            ['xsel', ['--clipboard', '--input']],
          ];
  for (const [command, args] of choices) {
    const ok = await new Promise((resolve) => {
      const child = spawn(command, args, {
        windowsHide: true,
        timeout: 5000,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
      child.stdin.on('error', () => {});
      child.stdin.end(String(text), 'utf8');
    });
    if (ok) return;
  }
  throw new Error(
    'Clipboard unavailable. Use Shift+drag and your terminal copy shortcut, or install a clipboard utility.',
  );
}
module.exports = { copyText };
