'use strict';
// Keeps one warm diagnostics worker per project so repeated edits reuse the loaded
// TypeScript compiler and parsed tsconfig instead of paying module load from scratch
// on every written file. Workers retire after an idle timeout; a hung run is
// terminated by the per-request deadline and the next request spawns a fresh worker.
const { Worker } = require('node:worker_threads');
const path = require('node:path');

const IDLE_MS = 30000;
const pools = new Map();

function state(project) {
  let entry = pools.get(project);
  if (!entry) pools.set(project, entry = { worker: null, jobs: new Map(), seq: 0, idle: null });
  return entry;
}

function spawn(project) {
  const entry = state(project);
  entry.worker = new Worker(path.join(__dirname, 'diagnostics-worker.js'), { resourceLimits: { maxOldGenerationSizeMb: 256 } });
  const worker = entry.worker;
  worker.unref();
  worker.on('message', message => {
    const job = entry.jobs.get(message.id);
    if (!job) return;
    entry.jobs.delete(message.id);
    clearTimeout(job.timer);
    job.settle(message.error ? new Error(message.error) : message);
    // Delivering a message re-refs the main-side port and would keep the process
    // alive despite the unref in spawn; release it again once the reply lands.
    worker.unref();
  });
  const drop = error => {
    if (entry.worker !== worker) return;
    entry.worker = null;
    for (const job of entry.jobs.values()) { clearTimeout(job.timer); job.settle(error); }
    entry.jobs.clear();
  };
  worker.once('error', drop);
  worker.once('exit', code => drop(new Error(`Diagnostics worker exited unexpectedly (${code})`)));
  restartIdle(project);
}

function restartIdle(project) {
  const entry = state(project);
  if (entry.idle) clearTimeout(entry.idle);
  entry.idle = setTimeout(() => {
    if (!entry.jobs.size && entry.worker) { void entry.worker.terminate(); entry.worker = null; }
  }, IDLE_MS);
  entry.idle.unref();
}

function runDiagnostics(project, file, { signal, timeoutMs = 10000, timeoutMessage = 'Automatic diagnostics exceeded 10 seconds; run a targeted validation separately' } = {}) {
  signal?.throwIfAborted();
  const entry = state(project);
  if (!entry.worker) spawn(project);
  restartIdle(project);
  return new Promise((resolve, reject) => {
    const id = ++entry.seq;
    let timer, abort, settle;
    const finished = new Promise((res, rej) => { settle = done => { clearTimeout(timer); signal?.removeEventListener('abort', abort); done instanceof Error ? rej(done) : res(done); }; });
    timer = setTimeout(() => {
      entry.jobs.delete(id);
      if (entry.worker) { void entry.worker.terminate(); entry.worker = null; }
      settle(new Error(timeoutMessage));
    }, timeoutMs);
    abort = () => { entry.jobs.delete(id); settle(signal.reason); };
    signal?.addEventListener('abort', abort, { once: true });
    finished.then(resolve, reject);
    entry.jobs.set(id, { timer, settle });
    entry.worker.postMessage({ id, project, file });
  });
}

module.exports = { runDiagnostics };
