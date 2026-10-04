const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createTools } = require('../src/services/core-tools');
const { createCliLibrary } = require('../cli/library');
const { readOnly } = require('../src/services/agent-workflow');
const { LiveControls } = require('../cli/live-controls');
const root = path.resolve(__dirname, '..'), id = 'skills/achernar/achernar-ui-design';
function setup(options = {}) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-ui-template-')), events = [], tracked = [];
  const extensions = createCliLibrary(root, path.join(project, 'home'));
  const tools = createTools({ project, extensions, mode: 'all', signal: AbortSignal.timeout(10000), emit: e => events.push(e), trackMutation: async (operation, info) => { tracked.push(info); return operation(); }, ...options });
  return { tools, extensions, project, events, tracked };
}
test('official UI templates are discoverable and create exact assets with tracked changes', async () => {
  const { tools, extensions, project, events, tracked } = setup();
  const found = await tools.execute('skills', { action: 'list', query: 'achernar-ui-design' }); assert.equal(found[0].id, id);
  for (const template of ['workbench', 'data-overview', 'editorial']) {
    const resource = `assets/templates/${template}.html`, original = extensions.detail(id, resource).content;
    assert.ok(extensions.detail(id).files.includes(resource));
    const output = await tools.execute('files', { action: 'write', path: `${template}.html`, template });
    assert.equal(fs.readFileSync(path.join(project, output.written), 'utf8'), original);
    assert.equal(events.at(-1).after, original); assert.equal(tracked.at(-1).relative, output.written);
  }
});
test('template writes preserve existing files, stay in workspace and validate arguments', async () => {
  const { tools, project } = setup(); fs.writeFileSync(path.join(project, 'existing.html'), 'user content');
  for (const args of [
    { action: 'write', path: 'existing.html', template: 'workbench' },
    { action: 'write', path: '../escape.html', template: 'workbench' },
    { action: 'write', path: 'a.html', template: '../../etc' },
    { action: 'write', path: 'a.html', template: 'workbench', content: 'ambiguous' },
    { action: 'edit', path: 'a.html', template: 'workbench' },
    { action: 'write', path: 'code.js', template: 'workbench' },
  ]) await assert.rejects(tools.execute('files', args));
  assert.equal(fs.readFileSync(path.join(project, 'existing.html'), 'utf8'), 'user content');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-ui-outside-'));
  fs.symlinkSync(outside, path.join(project, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(tools.execute('files', { action: 'write', path: 'link/escape.html', template: 'workbench' }));
});
test('template copies obey approval and both hosts read-only controls', async () => {
  let approvals = 0;
  const { tools, project, events, tracked } = setup({ mode: 'ask', ask: async () => { approvals++; return { approved: false }; } });
  const args = { action: 'write', path: 'denied.html', template: 'workbench' };
  assert.equal((await tools.execute('files', args)).denied, true); assert.equal(approvals, 1);
  assert.equal(fs.existsSync(path.join(project, args.path)), false); assert.equal(events.length, 0); assert.equal(tracked.length, 0);
  assert.throws(() => readOnly(tools).execute('files', args));
  assert.throws(() => new LiveControls({ mode: 'plan' }).assertAllowed('files', args));
});
test('template preview shows complete bytes before approval without touching disk', async () => {
  const { project, extensions } = setup(), events = [], signal = AbortSignal.timeout(10000);
  const draft = require('../src/services/file-drafts').createFileDrafts(project, e => events.push(e), signal, extensions);
  const args = { action: 'write', path: 'preview.html', template: 'workbench' };
  await draft('copy', args, true);
  assert.equal(events[0].text, extensions.detail(id, 'assets/templates/workbench.html').content);
  assert.equal(fs.existsSync(path.join(project, args.path)), false);
  fs.writeFileSync(path.join(project, args.path), 'user content');
  await draft('existing', args, true); assert.equal(events.length, 1);
});
