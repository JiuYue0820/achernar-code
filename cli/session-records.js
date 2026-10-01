'use strict';
const fs = require('node:fs'),
  path = require('node:path');
const { projectHome, sameProject } = require('./project-trust');
function sessionFile(home, id, project) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))
    throw Object.assign(new Error('Invalid session ID'), { code: 'INVALID_SESSION_ID' });
  const legacy = path.join(path.resolve(home), 'sessions', id + '.json');
  if (!project) return legacy;
  const scoped = path.join(projectHome(home, project), 'sessions', id + '.json');
  for (const file of [scoped, legacy]) {
    if (!fs.existsSync(file)) continue;
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!sameProject(record.project, project) || record.id !== id)
      throw Object.assign(
        new Error('Session belongs to another project. Open its directory first.'),
        { code: 'SESSION_PROJECT_MISMATCH' },
      );
    return file;
  }
  return scoped;
}
function releaseLock(lock, file) {
  let failure;
  try {
    fs.closeSync(lock);
  } catch (error) {
    failure = error;
  }
  try {
    fs.unlinkSync(file + '.lock');
  } catch (error) {
    if (error.code !== 'ENOENT') failure ||= error;
  }
  if (failure) throw failure;
}
function listSessionFiles(
  home,
  read = (file) => JSON.parse(fs.readFileSync(file, 'utf8')),
  project,
) {
  const dirs = [path.join(home, 'sessions')];
  if (project) dirs.unshift(path.join(projectHome(home, project), 'sessions'));
  const seen = new Set();
  return dirs
    .flatMap((dir) =>
      fs.existsSync(dir)
        ? fs
            .readdirSync(dir)
            .filter((file) => file.endsWith('.json'))
            .flatMap((file) => {
              try {
                sessionFile(home, file.slice(0, -5)); // Validate ID before reading.
                const session = read(path.join(dir, file));
                if (
                  !session ||
                  (project &&
                    (!sameProject(session.project, project) || session.id !== file.slice(0, -5))) ||
                  seen.has(session.id)
                )
                  return [];
                seen.add(session.id);
                return [session];
              } catch {
                return [];
              }
            })
        : [],
    )
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}
function deleteSessionRecord(home, id, project) {
  const file = sessionFile(home, id, project);
  if (!fs.existsSync(file))
    throw Object.assign(new Error('Session not found in this project'), {
      code: 'SESSION_NOT_FOUND',
    });
  let lock;
  try {
    lock = fs.openSync(file + '.lock', 'wx');
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error('This session is running. Stop it before deleting.', { cause: error });
    throw error;
  }
  try {
    fs.unlinkSync(file);
  } finally {
    releaseLock(lock, file);
  }
}
module.exports = { deleteSessionRecord, sessionFile, releaseLock, listSessionFiles };
