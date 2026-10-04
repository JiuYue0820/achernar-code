const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const api = (() => { try { return require('../cli/session-export'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; return {}; } })();
test('export strips credentials, machine paths and attachments without mutating the original session', async t => {
  assert.equal(typeof api.exportSession, 'function');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-export-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { id: 'test', project: root, apiKey: 'private-key', messages: [{ role: 'user', content: `Bearer secret-token work in ${root}`, images: [{ data: 'data:image/png;base64,private' }] }, { role: 'assistant', content: 'API_KEY="sk-testsecret1234567890"\nconst answer=42;' }], lastEvents: [{ arguments: { password: 'do-not-share', token: 'hidden' } }] };
  const original = JSON.stringify(session), file = path.join(root, 'shared.json');
  const result = await api.exportSession(session, file, { secrets: ['private-key'] });
  const text = fs.readFileSync(file, 'utf8'), exported = JSON.parse(text);
  assert.equal(exported.format, 'achernar-session'); assert.equal(exported.version, 1);
  assert.equal(result.path, file); assert.equal(JSON.stringify(session), original);
  for (const secret of ['private-key', 'secret-token', root, 'sk-testsecret1234567890', 'do-not-share', 'base64,private', '"hidden"']) assert.ok(!text.includes(secret), secret);
  assert.match(text, /const answer=42/); await assert.rejects(api.exportSession(session, file), /exist|EEXIST/i);
});
