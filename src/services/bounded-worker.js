const { Worker } = require('node:worker_threads');

function boundedWorker(filename, data, { signal, timeoutMs = 10000, timeoutMessage = 'Worker deadline exceeded' } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(filename, { workerData: data, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(signal.reason);
    const timer = setTimeout(() => finish(new Error(timeoutMessage)), timeoutMs);
    worker.once('message', value => value.error ? finish(new Error(value.error)) : finish(null, value));
    worker.once('error', finish);
    worker.once('exit', code => { if (!done) finish(new Error(`Worker exited without a result (${code})`)); });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
module.exports = { boundedWorker };
