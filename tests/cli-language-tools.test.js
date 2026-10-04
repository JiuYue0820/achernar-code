const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createLanguageTools } = require('../cli/language-tools');
const { LiveControls, requiresApproval } = require('../cli/live-controls');

test('real bundled LSP resolves cross-file symbols, references, types and diagnostics through aliased project roots', { timeout: 45000 }, async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-language-test-'));
  const actual = path.join(parent, 'project'), root = path.join(parent, 'alias');
  fs.mkdirSync(actual);
  fs.symlinkSync(actual, root, process.platform === 'win32' ? 'junction' : 'dir');
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'es2022' }, include: ['*.ts'] }));
  fs.writeFileSync(path.join(root, 'math.ts'), 'export function double(value: number): number { return value * 2; }\n');
  fs.writeFileSync(path.join(root, 'main.ts'), 'import { double } from "./math";\nconst result: string = double(3);\nconsole.log(result);\n');
  const service = createLanguageTools(root, { signal: AbortSignal.timeout(40000) });
  try {
    assert.ok((await service.execute({ action: 'symbols', path: 'math.ts' })).items.some(item => item.name === 'double' && item.line === 1));
    const definition = await service.execute({ action: 'definition', path: 'main.ts', line: 2, column: 25 });
    assert.ok(definition.items.some(item => item.path === 'math.ts'), JSON.stringify({ root, native: fs.realpathSync.native(root), definition }));
    assert.ok((await service.execute({ action: 'references', path: 'math.ts', line: 1, column: 18 })).items.some(item => item.path === 'main.ts' && item.line === 2));
    assert.match(JSON.stringify(await service.execute({ action: 'hover', path: 'main.ts', line: 2, column: 25 })), /number/);
    const before = await service.execute({ action: 'diagnostics', path: 'main.ts' });
    assert.ok(before.diagnostics.some(item => item.code === 2322 && item.line === 2 && /not assignable/.test(item.message)));
    fs.writeFileSync(path.join(root, 'math.ts'), 'export function double(value: number): string { return String(value * 2); }\n');
    const after = await service.execute({ action: 'diagnostics', path: 'main.ts' });
    assert.equal(after.complete, true); assert.equal(after.diagnostics.length, 0);
    await assert.rejects(service.execute({ action: 'definition', path: 'main.ts', line: 999, column: 1 }), /valid 1-based/);
    await assert.rejects(service.execute({ action: 'symbols', path: '../outside.ts' }), /项目/);
    await assert.rejects(service.execute({ action: 'rename', path: 'math.ts' }), /Invalid/);
    await assert.rejects(service.execute({ action: 'symbols', path: 'main.py' }), /JavaScript/);
  } finally { await service.close(); }
});
test('LSP respects Strict and remains read-only in Plan and Review', () => {
  for (const mode of ['plan', 'review']) {
    const controls = new LiveControls({ mode });
    controls.assertAllowed('lsp', { action: 'references' });
    assert.throws(() => controls.assertAllowed('lsp', { action: 'rename' }), /Switch to Code/);
  }
  assert.equal(requiresApproval('strict', 'lsp', { action: 'symbols' }), true);
  assert.equal(requiresApproval('code', 'lsp', { action: 'symbols' }), false);
});
test('aborting language queries terminates the owned server and prevents further requests', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-language-abort-'));
  fs.writeFileSync(path.join(root, 'main.ts'), 'export const x = 1;\n');
  const controller = new AbortController(), service = createLanguageTools(root, { signal: controller.signal });
  const pending = service.execute({ action: 'symbols', path: 'main.ts' }); controller.abort(new Error('test-canceled'));
  await assert.rejects(pending, /test-canceled/);
  await assert.rejects(service.execute({ action: 'symbols', path: 'main.ts' }), /test-canceled/);
  await service.close();
});
test('CLI read-only tool router permits real LSP queries and refuses removed desktop tools', () => {
  const { spawnSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'achernar-language-route-'));
  fs.writeFileSync(path.join(root, 'index.ts'), 'export const answer = 42;\n');
  const entry = path.resolve(__dirname, '../cli/index.js');
  const run = (name, args, options = []) => spawnSync(process.execPath, [entry, '--trust-project', '-C', root, '--json', ...options, 'tool-call', name, JSON.stringify(args)], {
    env: { ...process.env, ACHERNAR_CLI_HOME: path.join(root, 'home'), ACHERNAR_NOTIFICATIONS: '0' }, encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
  const read = run('lsp', { action: 'symbols', path: 'index.ts' });
  assert.equal(read.status, 0, read.stdout + read.stderr); assert.ok(JSON.parse(read.stdout).data.items.some(item => item.name === 'answer'));
  for (const name of ['computer', 'browser', 'memory', 'artifacts']) {
    const removed = run(name, { action: 'screenshot' }); assert.equal(removed.status, 1); assert.equal(JSON.parse(removed.stdout).ok, false);
  }
  const isolated = run('lsp', { action: 'symbols', path: 'index.ts' }, ['--sandbox', 'docker']);
  assert.equal(isolated.status, 1); assert.match(JSON.parse(isolated.stdout).error.message, /unavailable/);
});
