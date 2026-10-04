const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { randomUUID } = require('node:crypto');
const { deleteSessionRecord } = require('../cli/session-records');
test('deleting CLI history preserves project files and rejects running sessions and invalid IDs', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-session-delete-')), id = randomUUID();
  fs.mkdirSync(path.join(home, 'sessions')); const record = path.join(home, 'sessions', id + '.json');
  fs.writeFileSync(path.join(home, 'project.txt'), 'keep'); fs.writeFileSync(record, '{}'); fs.writeFileSync(record + '.lock', '');
  assert.throws(() => deleteSessionRecord(home, id), /running/); assert.ok(fs.existsSync(record));
  fs.unlinkSync(record + '.lock'); assert.throws(() => deleteSessionRecord(home, '../outside'), /Invalid/);
  deleteSessionRecord(home, id); assert.equal(fs.existsSync(record), false); assert.equal(fs.existsSync(record + '.lock'), false);
  assert.equal(fs.readFileSync(path.join(home, 'project.txt'), 'utf8'), 'keep');
});
