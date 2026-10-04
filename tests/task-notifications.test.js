const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createTaskNotifications, createElectronNotificationSender } = require('../src/services/task-notifications');
const { createWindowsNotificationSender } = require('../src/services/windows-notifications');
const { createApprovalBroker } = require('../src/services/approval');
const { LiveControls } = require('../cli/live-controls');
const settle = () => new Promise(resolve => setImmediate(resolve));
test('answered requests and canceled tasks abort pending OS notifications', async () => {
  const sent = [], service = createTaskNotifications({ send: payload => { sent.push(payload); return Promise.resolve(true); }, enabled: true });
  const run = service.start(), waiting = new AbortController();
  await run.attention('approval', 'first', { signal: waiting.signal });
  assert.ok(sent[0].signal);
  waiting.abort();
  assert.equal(sent[0].signal.aborted, true);
  await run.attention('question', 'second');
  run.close();
  assert.equal(sent[1].signal.aborted, true);
  await run.complete();
  assert.equal(sent.length, 2);
});
test('delayed Electron initialization never displays an obsolete request', async () => {
  let ready, shown = 0;
  class Notification extends EventEmitter { static isSupported() { return true; } show() { shown++; } close() {} }
  const send = createElectronNotificationSender({ Notification, initialize: new Promise(resolve => ready = resolve) });
  const canceled = new AbortController(), result = send({ title: 'old', signal: canceled.signal });
  canceled.abort(); ready();
  assert.equal(await result, false);
  assert.equal(shown, 0);
});
test('Windows helper is terminated when its waiting request is answered', async t => {
  const before = process.env.ACHERNAR_NOTIFICATIONS; delete process.env.ACHERNAR_NOTIFICATIONS;
  t.after(() => { if (before === undefined) delete process.env.ACHERNAR_NOTIFICATIONS; else process.env.ACHERNAR_NOTIFICATIONS = before; });
  let killed = false;
  const spawnProcess = () => {
    const child = new EventEmitter();
    for (const key of ['stdin', 'stdout', 'stderr']) child[key] = new PassThrough();
    child.kill = () => { killed = true; child.emit('close', 1); };
    return child;
  };
  const controller = new AbortController();
  const result = createWindowsNotificationSender({ platform: 'win32', spawnProcess, timeoutMs: 100 })({ signal: controller.signal });
  controller.abort();
  assert.equal(killed, true);
  assert.equal(await result, false);
  assert.equal(killed, true);
});
test('task notifications deduplicate requests and success, ignore redraws/cancellation, isolate successive tasks', async () => {
  const sent = [], service = createTaskNotifications({ send: async value => { sent.push(value); return true; }, enabled: true });
  const run = service.start();
  await run.attention('approval', 'request'); await run.attention('approval', 'request'); await run.attention('token', 'noise');
  await run.attention('question', 'choice'); await run.complete(); await run.complete(); await run.attention('approval', 'late');
  assert.deepEqual(sent.map(s => s.kind), ['approval', 'question', 'complete']);
  const canceled = service.start(); canceled.close(); await canceled.complete(); assert.equal(sent.length, 3);
  await service.start({ source: 'cli', language: 'en' }).complete(); assert.match(sent.at(-1).title, /Achernar Code.*Task complete/);
  await createTaskNotifications({ send: () => { throw Error('offline'); }, enabled: true }).start().complete();
  await createTaskNotifications({ send: () => assert.fail('disabled'), enabled: false }).start().complete();
});
test('approval notifications originate from waiting broker entries and do not bypass live approvals', async () => {
  const requests = [], events = [], broker = createApprovalBroker({ onRequest: (p, id) => requests.push({ type: p.type, id }) });
  const signal = AbortSignal.timeout(5000);
  const approval = broker.request({ type: 'approval', tool: 'files' }, signal, e => events.push(e)); await settle();
  broker.applyMode('all'); await approval;
  const question = broker.request({ type: 'question', question: 'Private question' }, signal, e => events.push(e)); await settle();
  broker.applyMode('all'); assert.equal(broker.has(requests.at(-1).id, 'question'), true);
  broker.answer(requests.at(-1).id, { approved: true, text: 'answer' }); await question;
  assert.deepEqual(requests.map(e => e.type), ['approval', 'question']);
});
test('CLI approval emits one attention event across mode changes and none for auto-approved work', async () => {
  let count = 0, choice = 0;
  const live = new LiveControls(), ui = { state: {}, notice() {}, finishQuestion() {}, choose: async () => ['strict', 'code', 'allow'][choice++] };
  const options = { ui, signal: AbortSignal.timeout(5000), project: 'fixture', onWaiting: () => count++ };
  assert.equal(await live.authorize('terminal', { command: 'private' }, options), true); assert.equal(count, 1);
  live.setApproval('auto'); await live.authorize('terminal', {}, options); assert.equal(count, 1);
});
test('Electron adapter clicks focus target and fails harmlessly when unsupported', async () => {
  const instances = []; let clicked = 0;
  class Notification extends EventEmitter { static isSupported() { return true; } constructor(options) { super(); this.options = options; instances.push(this); } show() {} close() { this.emit('close'); } }
  const send = createElectronNotificationSender({ Notification }); assert.equal(await send({ title: 'Ready', body: 'Return', onClick: () => clicked++ }), true);
  instances[0].emit('click'); await settle(); assert.equal(clicked, 1); send.dispose(); assert.equal(await send({}), false);
  Notification.isSupported = () => false; assert.equal(await createElectronNotificationSender({ Notification })({}), false);
});
test('Windows helper uses hidden structured stdin, isolates output and bounds process lifetime', async () => {
  const before = process.env.ACHERNAR_NOTIFICATIONS; delete process.env.ACHERNAR_NOTIFICATIONS;
  try {
    let options, args, text = '';
    const spawnProcess = (_exe, argv, opts) => { args = argv; options = opts; const p = new EventEmitter(); p.stdout = new PassThrough(); p.stderr = new PassThrough(); p.stdin = new PassThrough(); p.kill = () => {};
      p.stdin.on('data', b => text += b); p.stdin.on('finish', () => { p.stdout.write('ok'); p.emit('close', 0); }); return p; };
    assert.equal(await createWindowsNotificationSender({ platform: 'win32', spawnProcess })({ title: '<xml>& $(noop)', body: 'test' }), true);
    assert.equal(options.windowsHide, true); assert.ok(!args.some(a => a.includes('$(noop)'))); assert.equal(JSON.parse(text).title, '<xml>& $(noop)');
    let killed = false;
    const hang = () => { const p = new EventEmitter(); for (const key of ['stdin', 'stdout', 'stderr']) p[key] = new PassThrough(); p.kill = () => killed = true; return p; };
    assert.equal(await createWindowsNotificationSender({ platform: 'win32', spawnProcess: hang, timeoutMs: 10 })({}), false); assert.equal(killed, true);
  } finally { if (before === undefined) delete process.env.ACHERNAR_NOTIFICATIONS; else process.env.ACHERNAR_NOTIFICATIONS = before; }
});
