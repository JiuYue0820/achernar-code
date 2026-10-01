'use strict';
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const toolDefinition = {
  type: 'function',
  function: {
    name: 'git',
    description:
      'Structured Git status, diff and log. stage changes only explicit literal paths and requires the live approval policy. Never commits, resets or discards files. Prefer this over shell Git.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['status', 'diff', 'log', 'stage'] },
        paths: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: { type: 'string', minLength: 1, maxLength: 1000 },
        },
        staged: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
  },
};
const validate = new (require('ajv'))({ strict: false }).compile(
  toolDefinition.function.parameters,
);
function createGitTools(project, signal) {
  async function git(args) {
    const result = await run(
      'git',
      ['--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', ...args],
      {
        cwd: project,
        encoding: 'utf8',
        windowsHide: true,
        signal,
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))),
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          GIT_PAGER: 'cat',
        },
      },
    );
    return result.stdout;
  }
  async function execute(args) {
    signal?.throwIfAborted();
    if (!validate(args))
      throw new Error('Invalid Git arguments: ' + JSON.stringify(validate.errors));
    const paths = args.paths || [];
    for (const file of paths) {
      if (
        /[\0\r\n]/.test(file) ||
        path.isAbsolute(file) ||
        file.split(/[\\/]/).includes('..') ||
        !file.trim()
      )
        throw new Error('Git paths must be literal project-relative paths');
      await require('../src/services/project-path').projectPath(project, file);
    }
    if (args.action === 'stage') {
      if (!paths.length)
        throw new Error('Git stage requires explicit paths; blanket staging is not allowed');
      if (paths.some((file) => file === '.' || file === './'))
        throw new Error('Stage individual files or a named subdirectory');
      await git(['add', '--', ...paths]);
      return { staged: paths, ...(await execute({ action: 'status' })) };
    }
    if (args.action === 'status') {
      const raw = await git([
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=normal',
        '--ignore-submodules=all',
        ...(paths.length ? ['--', ...paths] : []),
      ]);
      const records = raw.split('\0'),
        files = [];
      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        if (!row) continue;
        files.push({
          index: row[0],
          worktree: row[1],
          path: row.slice(3),
          ...(/[RC]/.test(row.slice(0, 2)) ? { originalPath: records[++i] } : {}),
        });
      }
      return {
        files: files.slice(0, 500),
        truncated: files.length > 500,
        clean: files.length === 0,
      };
    }
    if (args.action === 'diff') {
      const diff = await git([
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--ignore-submodules=all',
        '--unified=3',
        ...(args.staged ? ['--cached'] : []),
        '--',
        ...paths,
      ]);
      return {
        diff: diff.slice(0, 50000),
        staged: Boolean(args.staged),
        truncated: diff.length > 50000,
      };
    }
    const output = await git([
      'log',
      '-z',
      `-${args.limit || 10}`,
      '--format=%H%x00%h%x00%aI%x00%s',
      '--',
      ...paths,
    ]);
    const fields = output.split('\0'),
      commits = [];
    for (let i = 0; i + 3 < fields.length; i += 4)
      commits.push({
        hash: fields[i],
        shortHash: fields[i + 1],
        date: fields[i + 2],
        subject: fields[i + 3],
      });
    return { commits };
  }
  return { execute, definition: toolDefinition };
}
module.exports = { createGitTools, toolDefinition };
