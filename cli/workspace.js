'use strict';
const fs = require('node:fs'),
  path = require('node:path');
const { projectPath } = require('../src/services/project-path');

function directory(value, relativeTo = process.cwd()) {
  const input = String(value || '')
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2');
  if (!input) throw new Error('Enter a directory path.');
  const result = fs.realpathSync.native(path.resolve(relativeTo, input));
  if (!fs.statSync(result).isDirectory()) throw new Error('Not a directory: ' + result);
  return result;
}
function contains(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function createWorkspace(project, extras = [], approve = async () => false, changed = () => {}) {
  const root = directory(project),
    roots = [...new Set([root, ...extras.map((value) => directory(value, root))])];
  function list() {
    return { project: root, directories: [...roots] };
  }
  async function add(value, requestApproval = true) {
    const target = directory(value, root);
    if (roots.includes(target)) return { added: false, ...list() };
    if (requestApproval && !(await approve(target)))
      return {
        denied: true,
        message:
          'Directory access denied. Ask the user to use /add-dir or --add-dir. Never bypass this refusal through the terminal.',
        ...list(),
      };
    roots.push(target);
    changed([...roots]);
    return { added: true, ...list() };
  }
  async function resolveFile(args) {
    if (args.root != null && (typeof args.root !== 'string' || !args.root.trim()))
      throw new Error('root must be a directory path.');
    const anchor = args.root ? directory(args.root, root) : root;
    const target = path.resolve(anchor, String(args.path || '.'));
    // Prefer the narrowest admitted root so an overlapping directory keeps its own rules.
    const owner = roots
      .filter((candidate) => contains(candidate, target))
      .sort((a, b) => b.length - a.length)[0];
    if (!owner)
      throw new Error(
        'Directory not admitted. Use workspace.add to request access: ' + path.dirname(target),
      );
    const relative = path.relative(owner, target) || '.';
    await projectPath(owner, relative); // Includes resolved-ancestor checks for links and new files.
    const { root: _ignored, ...input } = args;
    return { project: owner, args: { ...input, path: relative } };
  }
  async function resolveTerminal(args) {
    if (args.cwd != null && (typeof args.cwd !== 'string' || !args.cwd.trim()))
      throw new Error('cwd must be a directory path.');
    const target = args.cwd ? directory(args.cwd, root) : root;
    if (!roots.some((candidate) => contains(candidate, target)))
      throw new Error('Command directory not admitted. Use workspace.add to request access.');
    const { cwd: _ignored, ...input } = args;
    return { project: target, args: input };
  }
  const definition = {
    type: 'function',
    function: {
      name: 'workspace',
      description:
        'List admitted working directories or request access to another existing directory. add requires user consent; never use terminal to bypass a denial. Use files.root or terminal.cwd after adding. Read that directory AGENTS.md before editing.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['list', 'add'] },
          path: {
            type: 'string',
            description: 'Directory to add; relative to primary project or absolute',
          },
        },
      },
    },
  };
  async function execute(args) {
    if (
      !args ||
      Object.keys(args).some((key) => !['action', 'path'].includes(key)) ||
      !['list', 'add'].includes(args.action)
    )
      throw new Error('Invalid workspace arguments.');
    if (args.action === 'list') return list();
    if (typeof args.path !== 'string' || !args.path.trim())
      throw new Error('Provide the directory to admit.');
    return add(args.path);
  }
  const instructions = () =>
    [
      'CLI working directories: ' + JSON.stringify(list()),
      'Relative files paths use the primary project. For another admitted directory, set files.root to its absolute path, or use an absolute files.path. terminal.cwd selects the command working directory. Never assume the CLI install directory is the project.',
      'Use workspace.add to request another directory only when needed by the user task. A denied request cannot be bypassed using shell. Read AGENTS.md and applicable nested rules in each directory before modifying it. Existing operation approvals remain in force.',
    ].join('\n');
  return { list, add, resolveFile, resolveTerminal, definition, execute, instructions };
}
module.exports = { createWorkspace, directory };
