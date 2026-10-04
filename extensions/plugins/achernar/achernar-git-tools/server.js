'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createServer, z } = require('../../../lib/mcp-server');
const exec = promisify(execFile);
const root = fs.realpathSync(process.env.ACHERNAR_PROJECT_ROOT || process.cwd());
const server = createServer('achernar-git-tools');
const repo = z.string().max(1024).default('.').describe('Repository directory relative to ACHERNAR_PROJECT_ROOT.');
function inside(target) {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Repository leaves configured project');
  return target;
}
async function git(directory, args, signal) {
  try {
    const result = await exec('git', ['--no-optional-locks', '--literal-pathspecs', '-C', directory, ...args], {
      windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024, signal,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' }
    });
    return result.stdout;
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error(error.code === 'ENOENT' ? 'Git is not installed or not on PATH' : 'Git failed: check repository, history, timeout or output size');
  }
}
async function inspect(repo, args, signal) {
  if (path.isAbsolute(repo)) throw new Error('Use a relative repository path');
  const directory = inside(fs.realpathSync(inside(path.resolve(root, repo))));
  const top = (await git(directory, ['rev-parse', '--show-toplevel'], signal)).trim();
  inside(fs.realpathSync(top));
  const output = await git(directory, args, signal);
  return { repository: top, truncated: output.length > 50000, output: output.slice(0,50000) };
}
server.tool('git_status', 'Read branch and working-tree status without modifying files or index.', { repo },
  ({ repo }, signal) => inspect(repo, ['status', '--short', '--branch', '--untracked-files=normal'], signal));
server.tool('git_log', 'Read recent commit hashes, subjects and authors. Does not fetch remotes.', {
  repo, count: z.number().int().min(1).max(50).default(10)
}, ({ repo, count }, signal) => inspect(repo, ['log', '--no-show-signature', `--max-count=${count}`, '--format=%h %aI %an %s'], signal));
server.tool('git_diff', 'Read staged or unstaged diff without external diff commands or text converters.', {
  repo, staged: z.boolean().default(false), file: z.string().max(1024).optional()
}, ({ repo, staged, file }, signal) => {
  if (file && (path.isAbsolute(file) || file.split(/[\\/]/).includes('..'))) throw new Error('Use a relative file inside the repository');
  return inspect(repo, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', ...(staged ? ['--cached'] : []), '--', ...(file ? [file] : [])], signal);
});
server.start();
