'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

function projectIdentity(project) {
  const root = fs.realpathSync.native(path.resolve(project));
  if (!fs.statSync(root).isDirectory()) throw new Error('Not a directory: ' + root);
  const identity = process.platform === 'win32' ? root.toLowerCase() : root;
  return { root, key: createHash('sha256').update(identity).digest('hex') };
}
function sameProject(left, right) {
  if (!left || !right) return false;
  try {
    return projectIdentity(left).key === projectIdentity(right).key;
  } catch {
    return false;
  }
}
function projectHome(home, project) {
  return path.join(path.resolve(home), 'projects', projectIdentity(project).key);
}
function createProjectTrust(home) {
  const fileFor = (project) => path.join(projectHome(home, project), 'trust.json');
  const isTrusted = (project) => {
    try {
      const record = JSON.parse(fs.readFileSync(fileFor(project), 'utf8'));
      return record.trusted === true && sameProject(record.project, project);
    } catch {
      return false;
    }
  };
  return {
    isTrusted,
    revoke(project) {
      fs.rmSync(fileFor(project), { force: true });
    },
    async ensure(project, { explicit = false, confirm } = {}) {
      const { root } = projectIdentity(project);
      if (isTrusted(root)) return root;
      if (!explicit && !(await confirm?.(root)))
        throw Object.assign(
          new Error(
            'Project is not trusted. Open this folder interactively to confirm, or use --trust-project for this directory.',
          ),
          { code: 'PROJECT_NOT_TRUSTED' },
        );
      const file = fileFor(root),
        temp = file + '.' + randomUUID() + '.tmp';
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        temp,
        JSON.stringify({ project: root, trusted: true, trustedAt: new Date().toISOString() }),
        { mode: 0o600 },
      );
      fs.renameSync(temp, file);
      return root;
    },
  };
}
module.exports = { projectIdentity, projectHome, sameProject, createProjectTrust };
