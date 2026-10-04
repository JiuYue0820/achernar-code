const { parentPort, workerData } = require('node:worker_threads');
try {
  const pattern = new RegExp(workerData.query, workerData.caseSensitive ? 'u' : 'iu'), matches = [];
  for (const { file, text } of workerData.files) {
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      if (pattern.test(lines[index])) matches.push({ path: file, line: index + 1, text: lines[index].slice(0, 400) });
      if (matches.length >= workerData.limit) break;
    }
    if (matches.length >= workerData.limit) break;
  }
  parentPort.postMessage({ matches });
} catch (error) { parentPort.postMessage({ error: error.message }); }
