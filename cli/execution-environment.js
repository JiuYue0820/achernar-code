'use strict';
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { runCommand, runProcess, shellSpec } = require('../src/services/commands');
const shells = ['auto', 'powershell', 'pwsh', 'cmd', 'sh', 'bash', 'zsh'];
function executionSettings(value = {}) {
  const shell = value.shell || 'auto',
    sandbox = value.sandbox || 'off',
    sandboxImage = value.sandboxImage || 'node:24-bookworm-slim';
  if (!shells.includes(shell)) throw new Error('Shell must be ' + shells.join(', '));
  if (!['off', 'restricted', 'job', 'docker'].includes(sandbox))
    throw new Error('Sandbox must be off, restricted, job or docker');
  const jobMemoryMb = Number(value.jobMemoryMb ?? 1024),
    jobProcesses = Number(value.jobProcesses ?? 32);
  if (!Number.isInteger(jobMemoryMb) || jobMemoryMb < 128 || jobMemoryMb > 16384)
    throw new Error('Job memory must be 128–16384 MiB');
  if (!Number.isInteger(jobProcesses) || jobProcesses < 1 || jobProcesses > 256)
    throw new Error('Job process limit must be 1–256');
  if (sandbox === 'docker' && !['auto', 'sh', 'bash', 'zsh'].includes(shell))
    throw new Error('Docker needs a Linux shell: select auto, sh, bash or zsh first');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,240}$/.test(sandboxImage))
    throw new Error('Invalid sandbox image reference');
  if (
    value.writePaths != null &&
    (!Array.isArray(value.writePaths) ||
      value.writePaths.length > 30 ||
      value.writePaths.some((p) => typeof p !== 'string' || !p.trim()))
  )
    throw new Error('writePaths must be a list of directory paths');
  return {
    shell,
    sandbox,
    sandboxImage,
    jobMemoryMb,
    jobProcesses,
    ...(value.writePaths ? { writePaths: value.writePaths } : {}),
  };
}
function dockerSpec(command, root, cwd, settings, name) {
  const relative = path.relative(root, cwd);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
    throw new Error('Docker command directory must be within this admitted project');
  if (/[,\r\n]/.test(root))
    throw new Error('Docker workspace paths cannot contain commas or newlines');
  const shell = settings.shell === 'auto' ? 'sh' : settings.shell;
  if (!['sh', 'bash', 'zsh'].includes(shell))
    throw new Error('Linux Docker execution needs sh, bash or zsh; use --shell auto');
  const args = [
    'run',
    '--rm',
    '--pull=never',
    '--name',
    name,
    '--network=none',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--pids-limit=128',
    '--memory=1g',
    '--cpus=2',
    '--tmpfs',
    '/tmp:rw,nosuid,nodev,size=256m',
    '--mount',
    `type=bind,source=${root},target=/workspace`,
    '--workdir',
    '/workspace' + (relative ? '/' + relative.split(path.sep).join('/') : ''),
    '--env',
    'HOME=/tmp',
    '--env',
    'TMPDIR=/tmp',
  ];
  if (process.platform !== 'win32' && process.getuid)
    args.push('--user', `${process.getuid()}:${process.getgid()}`);
  args.push(settings.sandboxImage, '/bin/' + shell, '-c', command);
  return { command: 'docker', args };
}
function windowsProcessEnvironment(source = process.env) {
  // PowerShell needs the Windows profile, architecture and module search
  // environment on server images too. Keep an explicit allowlist: API tokens
  // and NODE_OPTIONS must not enter the command process.
  const allowed =
    /^(?:path|pathext|systemroot|systemdrive|windir|comspec|temp|tmp|userprofile|username|userdomain(?:_roamingprofile)?|homedrive|homepath|logonserver|appdata|localappdata|programfiles(?:\(x86\))?|programw6432|commonprogramfiles(?:\(x86\))?|commonprogramw6432|programdata|processor_(?:architecture|identifier|level|revision)|number_of_processors|os|psmodulepath|achernar_job_trace)$/i;
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.test(key)));
}
function createExecutionEnvironment(value, root) {
  const settings = executionSettings(value);
  const contains = (root, file) => {
    const relative = path.relative(root, file);
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  };
  const canonical = async (file) => {
    let ancestor = file;
    while (true) {
      try {
        return path.resolve(
          await require('node:fs/promises').realpath(ancestor),
          path.relative(ancestor, file),
        );
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw error;
        ancestor = parent;
      }
    }
  };
  async function assertWrite(project, relative) {
    if (!['restricted', 'job'].includes(settings.sandbox)) return;
    const file = await canonical(
      await require('../src/services/project-path').projectPath(project, relative),
    );
    const roots = await Promise.all(
      (settings.writePaths || [root]).map(async (value) => {
        const absolute = path.resolve(root, value);
        // A nonexistent write root is resolved through its existing ancestors.
        return canonical(absolute);
      }),
    );
    if (!roots.some((allowed) => contains(allowed, file)))
      throw new Error('Path is outside the configured write allowlist: ' + relative);
  }
  const description = () =>
    settings.sandbox === 'docker'
      ? `Docker terminal isolation: Linux/${settings.shell === 'auto' ? 'sh' : settings.shell}; /workspace is the current admitted project. No network, host home, Docker socket or credentials are passed to commands. Root filesystem is read-only; workspace writes remain possible. Host MCP and LSP execution is disabled. Native file tools still operate on admitted host paths; web and model requests are outside container isolation. Never bypass this boundary.`
      : settings.sandbox === 'job'
        ? `Windows Job Object process limits: ${settings.jobProcesses} processes, ${settings.jobMemoryMb} MiB combined committed memory, kill descendants on exit. Built-in file writes use the configured allowlist. MCP/LSP remain available on the host. This is not filesystem or network isolation: commands retain user permissions. No unrestricted fallback.`
        : settings.sandbox === 'restricted'
          ? `Restricted file writes: built-in file mutations are limited to ${JSON.stringify(settings.writePaths || [root])}. MCP and LSP remain available. Terminal and MCP run with host permissions and are not confined by the write allowlist. This is not an OS sandbox. Never use another tool to bypass a rejected write.`
          : `Host terminal: ${shellSpec('', settings.shell).command}. Commands run with this user's permissions; approval is not a sandbox.`;
  async function run(command, cwd, signal, timeout, onOutput) {
    if (settings.sandbox === 'job') {
      if (process.platform !== 'win32')
        throw new Error('Windows Job Object mode is only available on Windows. No host fallback.');
      require('../src/services/commands').validateCommand(command);
      const spec = shellSpec(command, settings.shell);
      const env = windowsProcessEnvironment();
      const result = await runProcess(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-InputFormat',
          'Text',
          '-OutputFormat',
          'Text',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(__dirname, 'windows-job.ps1'),
        ],
        cwd,
        signal,
        timeout,
        onOutput,
        {
          env,
          input:
            JSON.stringify({
              ...spec,
              cwd,
              processes: settings.jobProcesses,
              memoryBytes: settings.jobMemoryMb * 1024 * 1024,
              trace: process.env.ACHERNAR_JOB_TRACE === '1',
            }) + '\n',
        },
      );
      if (result.exitCode === 126)
        throw new Error(
          'Windows Job Object unavailable; no host fallback. ' + result.stderr.slice(-1500),
        );
      return {
        ...result,
        isolation: 'windows-job',
        limits: { memoryMb: settings.jobMemoryMb, processes: settings.jobProcesses },
      };
    }
    if (settings.sandbox !== 'docker')
      return runCommand(command, cwd, signal, timeout, onOutput, settings);
    const name = 'achernar-' + randomUUID(),
      spec = dockerSpec(command, root, cwd, settings, name);
    let result, failure, cleanupFailure;
    try {
      result = await runProcess(spec.command, spec.args, cwd, signal, timeout, onOutput);
      if (result.exitCode === 125)
        throw new Error(
          'Docker could not start the isolated command. Start Docker and pull the configured image explicitly. No command ran on the host. ' +
            result.stderr.slice(-1200),
        );
    } catch (error) {
      failure = error;
    } finally {
      // Killing docker.exe alone does not terminate its container.
      try {
        const cleanup = await runProcess(
          'docker',
          ['rm', '-f', name],
          root,
          AbortSignal.timeout(10000),
          10000,
        );
        if (cleanup.exitCode !== 0 && !/No such container/i.test(cleanup.output))
          cleanupFailure = new Error(cleanup.output);
      } catch (error) {
        cleanupFailure = error;
      }
    }
    if (cleanupFailure && (result?.timedOut || signal.aborted))
      throw new Error(
        `Container cleanup could not be confirmed. Stop ${name} with docker rm -f ${name}. No host fallback was used.`,
        { cause: cleanupFailure },
      );
    if (failure) throw failure;
    return { ...result, isolation: 'docker-terminal', network: 'none' };
  }
  async function probe(signal = AbortSignal.timeout(10000)) {
    if (settings.sandbox === 'job') {
      try {
        const result = await run('echo achernar-job-ok', root, signal, 9000, () => {});
        return {
          ...settings,
          available: result.exitCode === 0 && result.stdout.includes('achernar-job-ok'),
          boundary: description(),
        };
      } catch (error) {
        return { ...settings, available: false, message: error.message, boundary: description() };
      }
    }
    if (settings.sandbox === 'docker') {
      try {
        const version = await runProcess(
          'docker',
          ['version', '--format', '{{.Server.Os}}'],
          root,
          signal,
          5000,
        );
        const image =
          version.exitCode === 0
            ? await runProcess(
                'docker',
                ['image', 'inspect', settings.sandboxImage, '--format', '{{.Os}}'],
                root,
                signal,
                5000,
              )
            : null;
        return {
          ...settings,
          available:
            version.exitCode === 0 &&
            version.stdout.trim() === 'linux' &&
            image?.stdout.trim() === 'linux',
          daemon: version.exitCode === 0 ? version.stdout.trim() : 'unavailable',
          imageAvailable: image?.exitCode === 0,
          boundary: 'terminal only; MCP and LSP disabled',
          setup: `Start Docker with Linux containers, then docker pull ${settings.sandboxImage}. No automatic download or host fallback.`,
        };
      } catch {
        return {
          ...settings,
          available: false,
          daemon: 'unavailable',
          boundary: 'terminal only; no host fallback',
        };
      }
    }
    try {
      const spec = shellSpec(
        settings.shell === 'cmd' ? 'echo achernar-shell-ok' : 'echo achernar-shell-ok',
        settings.shell,
      );
      const result = await runProcess(spec.command, spec.args, root, signal, 5000);
      return {
        ...settings,
        available: result.exitCode === 0,
        executable: spec.command,
        boundary:
          settings.sandbox === 'restricted'
            ? 'built-in file write allowlist only; terminal/MCP retain host permissions; not an OS sandbox'
            : 'host user permissions',
      };
    } catch (error) {
      return {
        ...settings,
        available: false,
        message: error.message,
        boundary: 'host user permissions',
      };
    }
  }
  return {
    settings,
    run,
    probe,
    description,
    assertWrite,
    allowsHostServices: settings.sandbox !== 'docker',
  };
}
module.exports = {
  executionSettings,
  createExecutionEnvironment,
  dockerSpec,
  shells,
  windowsProcessEnvironment,
};
