'use strict';
// Session files grow with every tool event, and rewriting the full JSON synchronously
// inside the event path makes long tasks quadratic. Coalesce writes behind a short
// debounce and serialize off the hot path; flush before the task lock is released.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function createSessionPersist(file, session, { delayMs = 150 } = {}) {
  let timer = null, dirty = false, inflight = false, queue = Promise.resolve(), failure = null;
  const writeAsync = () => {
    inflight = true;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + randomUUID() + '.tmp';
    return fs.promises.writeFile(tmp, JSON.stringify(session, null, 2), { mode: 0o600 })
      .then(() => fs.promises.rename(tmp, file))
      .then(() => { inflight = false; })
      .catch(error => { inflight = false; failure = failure || error; });
  };
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty) return queue;
    dirty = false;
    queue = queue.then(writeAsync, writeAsync);
    return queue;
  };
  const schedule = () => {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => { timer = null; void flush(); }, delayMs);
  };
  // Last-resort durability while the process is exiting: an async write still in
  // flight will never complete, so re-persist the live state synchronously.
  const flushSync = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty && !inflight) return;
    dirty = false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + randomUUID() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(session, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  return { schedule, flush, flushSync, get failure() { return failure; } };
}
module.exports = { createSessionPersist };
