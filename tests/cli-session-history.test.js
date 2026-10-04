const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const api = (() => { try { return require('../cli/session-history'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; return {}; } })();
async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'achernar-history-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project'), other = path.join(root, 'other');
  await fs.mkdir(project); await fs.mkdir(other);
  const session = { id: 'test-session', project, messages: [] };
  let stored;
  const save = async value => { stored = structuredClone(value); };
  return { root, project, other, session, save, stored: () => stored };
}
test('CLI checkpoint undo/redo restores a whole turn across admitted directories and its conversation', async t => {
  assert.equal(typeof api.createSessionHistory, 'function');
  const { root, project, other, session, save } = await setup(t);
  await fs.writeFile(path.join(project, 'old.txt'), 'before');
  const history = api.createSessionHistory(path.join(root, 'home'), session.id);
  const turn = history.start(session); session.messages.push({ role: 'user', content: 'edit two roots' });
  await turn.track(project, () => fs.writeFile(path.join(project, 'old.txt'), 'after'), { relative: 'old.txt' });
  await turn.track(other, () => fs.writeFile(path.join(other, 'new.txt'), 'new'), { relative: 'new.txt' });
  session.messages.push({ role: 'assistant', content: 'done' });
  await turn.finish(session); await save(session);
  assert.equal(session.turns[0].available, true);
  const undone = await history.undo(session, save);
  assert.equal(undone.prompt, 'edit two roots'); assert.equal(session.messages.length, 0);
  assert.equal(await fs.readFile(path.join(project, 'old.txt'), 'utf8'), 'before');
  await assert.rejects(fs.access(path.join(other, 'new.txt')));
  await history.redo(session, save);
  assert.equal(session.messages.length, 2);
  assert.equal(await fs.readFile(path.join(project, 'old.txt'), 'utf8'), 'after');
  assert.equal(await fs.readFile(path.join(other, 'new.txt'), 'utf8'), 'new');
});
test('rewind to an earlier user message restores multiple tasks atomically and redo restores the group', async t => {
  const { root, project, session, save } = await setup(t), file = path.join(project, 'multi.txt');
  await fs.writeFile(file, 'initial');
  const history = api.createSessionHistory(path.join(root, 'home'), session.id);
  for (const value of ['first', 'second']) {
    const turn = history.start(session); session.messages.push({ role: 'user', content: value });
    await turn.track(project, () => fs.writeFile(file, value), { relative: 'multi.txt' });
    session.messages.push({ role: 'assistant', content: 'done' }); await turn.finish(session);
  }
  await fs.writeFile(file, 'external user edit');
  await assert.rejects(history.undoTo(session, save, 0));
  assert.equal(session.messages.length, 4); assert.equal(await fs.readFile(file, 'utf8'), 'external user edit');
  await fs.writeFile(file, 'second');
  const result = await history.undoTo(session, save, 0);
  assert.equal(result.tasks, 2); assert.equal(result.prompt, 'first'); assert.equal(session.messages.length, 0);
  assert.equal(await fs.readFile(file, 'utf8'), 'initial');
  await history.redo(session, save);
  assert.equal(session.turns.length, 2); assert.equal(session.messages.length, 4); assert.equal(await fs.readFile(file, 'utf8'), 'second');
});
test('undo refuses later user edits; a failed session save rolls back disk and in-memory changes', async t => {
  assert.equal(typeof api.createSessionHistory, 'function');
  const { root, project, session, save } = await setup(t), file = path.join(project, 'test.txt');
  await fs.writeFile(file, 'before');
  const history = api.createSessionHistory(path.join(root, 'home'), session.id), turn = history.start(session);
  session.messages.push({ role: 'user', content: 'task' });
  await turn.track(project, () => fs.writeFile(file, 'after'), { relative: 'test.txt' });
  session.messages.push({ role: 'assistant', content: 'partial task failed', error: true });
  await turn.finish(session);
  await fs.writeFile(file, 'user edit');
  await assert.rejects(history.undo(session, save));
  assert.equal(await fs.readFile(file, 'utf8'), 'user edit');
  await fs.writeFile(file, 'after');
  await assert.rejects(history.undo(session, async () => { throw new Error('disk full'); }), /disk full/);
  assert.equal(await fs.readFile(file, 'utf8'), 'after'); assert.equal(session.messages.length, 2);
  await history.undo(session, save); assert.equal(await fs.readFile(file, 'utf8'), 'before');
});
test('checkpoint limits explicitly make undo unavailable instead of silently omitting changes', async t => {
  assert.equal(typeof api.createSessionHistory, 'function');
  const { root, project, session } = await setup(t);
  await fs.writeFile(path.join(project, 'large.txt'), 'x'.repeat(20));
  const history = api.createSessionHistory(path.join(root, 'home'), session.id, { maxBytes: 8 }), turn = history.start(session);
  session.messages.push({ role: 'user', content: 'task' });
  await turn.track(project, () => fs.writeFile(path.join(project, 'new.txt'), 'new'));
  session.messages.push({ role: 'assistant', content: 'done' }); await turn.finish(session);
  assert.equal(session.turns[0].available, false);
  await assert.rejects(history.undo(session, async () => {}), /snapshot|checkpoint/i);
  assert.equal(await fs.readFile(path.join(project, 'new.txt'), 'utf8'), 'new');
});
