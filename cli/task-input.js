'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path');
async function taskInput(words, options, cwd, input = process.stdin) {
  const inline = words.join(' ');
  if (
    [Boolean(inline.trim()), Boolean(options.taskFile), Boolean(options.stdin)].filter(Boolean)
      .length !== 1
  )
    throw new Error(
      'Provide exactly one task source: inline text, --task-file <path>, or --stdin.',
    );
  let bytes;
  if (options.taskFile) {
    const file = await fs.open(path.resolve(cwd, options.taskFile), 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 200000)
        throw new Error('Task file must be a text file of at most 200000 bytes.');
      bytes = Buffer.alloc(stat.size);
      const read = await file.read(bytes, 0, bytes.length, 0);
      bytes = bytes.subarray(0, read.bytesRead);
    } finally {
      await file.close();
    }
  } else if (options.stdin) {
    if (input.isTTY)
      throw new Error('--stdin requires piped input. Use chat for interactive input.');
    const chunks = [];
    let length = 0;
    for await (const chunk of input) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.length;
      if (length > 200000) throw new Error('Piped task exceeds 200000 bytes.');
      chunks.push(buffer);
    }
    bytes = Buffer.concat(chunks);
  } else bytes = Buffer.from(inline);
  if (bytes.includes(0)) throw new Error('Task input must be text, not binary.');
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  if (!text.trim()) throw new Error('Task input is empty.');
  return text;
}
module.exports = { taskInput };
