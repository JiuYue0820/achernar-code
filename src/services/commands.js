const { spawn } = require('node:child_process');
function validateCommand(command, platform = process.platform) {
  if (platform !== 'win32') return;
  const text = String(command);
  // Reject common broad browser cleanup mistakes. This is not a shell sandbox.
  const browser = '(?:chrome|msedge|firefox|brave|opera)(?:\\.exe)?';
  const byName = new RegExp('(?:Stop-Process|kill)\\s+[^;\\r\\n]*-Name\\s+["\\\']?' + browser + '\\b', 'i');
  const bareName = new RegExp('(?:Stop-Process|kill)\\s+["\\\']?' + browser + '\\b', 'i');
  const allBrowsers = new RegExp('Get-Process\\s+(?:-Name\\s+)?["\\\']?' + browser + '\\b[^;\\r\\n]*\\|[^;\\r\\n]*Stop-Process', 'i');
  const taskkill = new RegExp('taskkill(?:\\.exe)?\\b[^;\\r\\n]*/im\\s+["\\\']?' + browser + '\\b', 'i');
  if ([byName, bareName, allBrowsers, taskkill].some(pattern => pattern.test(text))) throw new Error('Refusing bulk browser termination by name. Close only the helper process PID created by this task; do not stop user browser sessions.');
}
function shellSpec(command, shell = 'auto', platform = process.platform) {
  if (shell === 'auto') shell = platform === 'win32' ? 'powershell' : 'sh';
  if (!['powershell', 'pwsh', 'cmd', 'sh', 'bash', 'zsh'].includes(shell)) throw new Error('Unknown shell: ' + shell);
  const windowsCommand = "$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$OutputEncoding=[Console]::OutputEncoding;\n" + command;
  if (shell === 'powershell' || shell === 'pwsh') return { command: shell === 'powershell' ? 'powershell.exe' : 'pwsh', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(windowsCommand, 'utf16le').toString('base64')] };
  if (shell === 'cmd') { if (platform !== 'win32') throw new Error('cmd is only available on Windows'); return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] }; }
  return { command: platform === 'win32' ? shell + '.exe' : '/bin/' + shell, args: ['-c', command] };
}
function runCommand(command, cwd, signal, timeout = 600000, onOutput = () => {}, options = {}) {
  signal.throwIfAborted();
  validateCommand(command);
  const spec = shellSpec(command, options.shell);
  return runProcess(spec.command, spec.args, cwd, signal, timeout, onOutput);
}
function runProcess(command, args, cwd, signal, timeout = 600000, onOutput = () => {}, options = {}) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, detached: process.platform !== 'win32', stdio: [options.input != null ? 'pipe' : 'ignore', 'pipe', 'pipe'], ...(options.env ? { env: options.env } : {}) });
    if (child.stdin) { child.stdin.on('error', () => {}); child.stdin.end(options.input); }
    let output = '', stdout = '', stderr = '', truncated = false, timedOut = false;
    const receive = (text, error) => { if (error) stderr = (stderr + text).slice(-60000); else stdout = (stdout + text).slice(-60000); output += text; if (output.length > 60000) { output = output.slice(-60000); truncated = true; } onOutput({ text, stream: error ? 'stderr' : 'stdout' }); };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => receive(text, false)); child.stderr.on('data', text => receive(text, true));
    const kill = () => { if (!child.pid) return; if (process.platform === 'win32') spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); else { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, Math.max(1000, Math.min(3600000, timeout)));
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', kill); };
    signal.addEventListener('abort', kill, { once: true });
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', code => { cleanup(); if (signal.aborted) reject(signal.reason); else resolve({ exitCode: code, output, stdout, stderr, truncated, timedOut }); });
    if (signal.aborted) kill();
  });
}
module.exports = { runCommand, runProcess, shellSpec, validateCommand };
