const test = require('node:test'), assert = require('node:assert/strict'), { Readable } = require('node:stream');
const { taskInput } = require('../cli/task-input');
test('piped tasks preserve multiline code, handle split Unicode and reject ambiguous or oversized input', async () => {
  const bytes = Buffer.from('Inspect:\n```ts\nconst 中文 = 42;\n```\n');
  assert.equal(await taskInput([], { stdin: true }, '.', Readable.from([bytes.subarray(0, 26), bytes.subarray(26)])), bytes.toString());
  await assert.rejects(taskInput(['inline'], { stdin: true }, '.'), /exactly one/);
  await assert.rejects(taskInput([], { stdin: true }, '.', Readable.from(['a'.repeat(200001)])), /200000/);
  await assert.rejects(taskInput([], { stdin: true }, '.', Readable.from(['a\0b'])), /binary/);
});
