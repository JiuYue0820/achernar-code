'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path');
const { promisify } = require('node:util'),
  { execFile } = require('node:child_process');
const run = promisify(execFile);
const write = async (root, name, content) => {
  await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await fs.writeFile(path.join(root, name), content);
};
const repaired = 'exports.clamp = (value, min, max) => Math.max(min, Math.min(max, value));\n';
const goodType = 'export const answer: number = 42;\n';
const receiptCheck = `const a=require('node:assert/strict'),{receipt}=require('./receipt');a.deepEqual(receipt([{price:.1,quantity:3},{price:.2,quantity:1}]),{total:.5,count:4});a.deepEqual(receipt([]),{total:0,count:0});a.deepEqual(receipt([{price:2.55,quantity:2}]),{total:5.1,count:2});`;
const repairCheck = `const assert=require('node:assert/strict'),{clamp}=require('./math.js');for(const [v,a,b,w] of [[5,0,10,5],[-2,0,10,0],[20,0,10,10],[3,3,3,3],[-5,-10,-1,-5]])assert.equal(clamp(v,a,b),w);`;
const call = (id, name, args) => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});
const tasks = [
  {
    id: 'json-repair',
    prompt:
      'Fix the invalid JSON in settings.json. Preserve name, enabled and paths exactly, and add a top-level numeric retries of 3. Use the file tools and check the automatic JSON diagnostics. Do not create other files.',
    async seed(root) {
      await write(root, 'settings.json', '{"name":"demo","enabled":true,"paths":["src","tests"],}');
    },
    async fixture(root) {
      await write(
        root,
        'settings.json',
        '{"name":"demo","enabled":true,"paths":["src","tests"],"retries":3}',
      );
      return [];
    },
    steps: [
      [call('read', 'files', { action: 'read', path: 'settings.json' })],
      [
        call('repair', 'files', {
          action: 'write',
          path: 'settings.json',
          content: '{"name":"demo","enabled":true,"paths":["src","tests"],"retries":3}',
        }),
      ],
    ],
    async accept(root) {
      try {
        const value = JSON.parse(await fs.readFile(path.join(root, 'settings.json'), 'utf8'));
        return {
          passed:
            value.name === 'demo' &&
            value.enabled === true &&
            value.retries === 3 &&
            JSON.stringify(value.paths) === '["src","tests"]' &&
            Object.keys(value).length === 4,
          check: 'valid JSON, preserved original fields and exact new retry setting',
        };
      } catch {
        return { passed: false, check: 'JSON repair missing or invalid' };
      }
    },
  },
  {
    id: 'multi-file-receipt',
    prompt:
      'Fix sum.js and receipt.js. sum(items) should sum price * quantity and round the numeric total to two decimal places. receipt(items) should return {total,count}, with count equal to total quantity, not number of lines. Keep both CommonJS APIs. Empty input should give zero total and count. Run node check.js. Do not modify check.js.',
    async seed(root) {
      await write(
        root,
        'sum.js',
        'exports.sum = items => items.reduce((n, i) => n + i.price, 0);\n',
      );
      await write(
        root,
        'receipt.js',
        "const {sum}=require('./sum'); exports.receipt=items=>({total:sum(items),count:items.length});\n",
      );
      await write(root, 'check.js', receiptCheck);
    },
    async fixture(root) {
      await write(
        root,
        'sum.js',
        'exports.sum = items => Math.round(items.reduce((n,i)=>n+i.price*i.quantity,0)*100)/100;\n',
      );
      await write(
        root,
        'receipt.js',
        "const {sum}=require('./sum'); exports.receipt=items=>({total:sum(items),count:items.reduce((n,i)=>n+i.quantity,0)});\n",
      );
      return [];
    },
    steps: [
      [
        call('read', 'files', { action: 'read', path: 'sum.js' }),
        call('read2', 'files', { action: 'read', path: 'receipt.js' }),
      ],
      [
        call('sum', 'files', {
          action: 'write',
          path: 'sum.js',
          content:
            'exports.sum = items => Math.round(items.reduce((n,i)=>n+i.price*i.quantity,0)*100)/100;\n',
        }),
        call('receipt', 'files', {
          action: 'write',
          path: 'receipt.js',
          content:
            "const {sum}=require('./sum'); exports.receipt=items=>({total:sum(items),count:items.reduce((n,i)=>n+i.quantity,0)});\n",
        }),
      ],
      [
        call('verify', 'terminal', {
          command: 'node check.js',
          reason: 'Verify independent receipt cases',
        }),
      ],
    ],
    async accept(root) {
      try {
        await run(process.execPath, ['-e', receiptCheck], {
          cwd: root,
          windowsHide: true,
          timeout: 5000,
        });
        return {
          passed: (await fs.readFile(path.join(root, 'check.js'), 'utf8')) === receiptCheck,
          check: 'multi-file API, quantity, rounding, empty input, unchanged checks',
        };
      } catch {
        return { passed: false, check: 'receipt assertions failed or checks changed' };
      }
    },
  },
  {
    id: 'repair-clamp',
    prompt:
      'Fix clamp in math.js so values below min become min, above max become max, and values inside the bounds remain unchanged. Keep its CommonJS API. Run node check.js; do not modify check.js. Make only the required change.',
    async seed(root) {
      await write(
        root,
        'math.js',
        'exports.clamp = (value, min, max) => Math.max(max, Math.min(min, value));\n',
      );
      await write(root, 'check.js', repairCheck);
    },
    async fixture(root) {
      await write(root, 'math.js', repaired);
      return [];
    },
    steps: [
      [call('read', 'files', { action: 'read', path: 'math.js' })],
      [call('edit', 'files', { action: 'write', path: 'math.js', content: repaired })],
      [
        call('check', 'terminal', {
          command: 'node check.js',
          reason: 'Verify clamp boundary cases',
        }),
      ],
    ],
    async accept(root) {
      try {
        const unchangedCheck =
          (await fs.readFile(path.join(root, 'check.js'), 'utf8')) === repairCheck;
        await run(process.execPath, ['-e', repairCheck], {
          cwd: root,
          windowsHide: true,
          timeout: 5000,
        });
        return {
          passed: unchangedCheck,
          check: 'five independent boundary assertions; original checks unchanged',
        };
      } catch {
        return {
          passed: false,
          check: 'clamp boundary assertions failed or original checks changed',
        };
      }
    },
  },
  {
    id: 'filtered-search',
    prompt:
      'Use files.search with regex and include/exclude filters to find case-insensitive count assignments (count followed by = or : and digits) in *.ts and *.tsx, excluding *.test.ts. Write report.json as {"files":[...]} with sorted project-relative paths. Do not modify source files.',
    async seed(root) {
      for (const [file, content] of Object.entries({
        'main.ts': 'const count = 42;\n',
        'src/view.tsx': 'Count: 23\n',
        'src/view.test.ts': 'count = 99\n',
        'notes.txt': 'count = 12\n',
      }))
        await write(root, file, content);
    },
    async fixture(root) {
      await write(root, 'report.json', '{"files":["main.ts","src/view.tsx"]}');
      return [
        {
          type: 'tool_result',
          name: 'files',
          arguments: {
            action: 'search',
            regex: true,
            include: ['*.{ts,tsx}'],
            exclude: ['**/*.test.ts'],
          },
          failed: false,
        },
      ];
    },
    steps: [
      [
        call('search', 'files', {
          action: 'search',
          path: '.',
          query: 'count\\s*[:=]\\s*\\d+',
          regex: true,
          include: ['*.{ts,tsx}'],
          exclude: ['**/*.test.ts'],
        }),
      ],
      [
        call('report', 'files', {
          action: 'write',
          path: 'report.json',
          content: '{"files":["main.ts","src/view.tsx"]}',
        }),
      ],
    ],
    async accept(root, events) {
      try {
        const data = JSON.parse(await fs.readFile(path.join(root, 'report.json'), 'utf8'));
        const used = events.some(
          (event) =>
            event.type === 'tool_result' &&
            event.name === 'files' &&
            event.arguments?.action === 'search' &&
            event.arguments.regex &&
            event.arguments.include?.length &&
            event.arguments.exclude?.length &&
            !event.failed,
        );
        const originals = {
          'main.ts': 'const count = 42;\n',
          'src/view.tsx': 'Count: 23\n',
          'src/view.test.ts': 'count = 99\n',
          'notes.txt': 'count = 12\n',
        };
        const unchanged = (
          await Promise.all(
            Object.entries(originals).map(
              async ([file, content]) =>
                (await fs.readFile(path.join(root, file), 'utf8')) === content,
            ),
          )
        ).every(Boolean);
        return {
          passed: used && unchanged && JSON.stringify(data.files) === '["main.ts","src/view.tsx"]',
          check: 'filtered regex invocation, exact paths and unchanged sources',
        };
      } catch {
        return { passed: false, check: 'missing or invalid search artifact' };
      }
    },
  },
  {
    id: 'typed-edit',
    prompt:
      'Fix the type error in answer.ts. Keep the exported answer typed as number and assign it the numeric value 42. Use files.edit and inspect its automatic diagnostics before finishing. Do not change tsconfig.json.',
    async seed(root) {
      await write(root, 'answer.ts', 'export const answer: number = "broken";\n');
      await write(root, 'tsconfig.json', '{"compilerOptions":{"strict":true,"noEmit":true}}');
    },
    async fixture(root) {
      await write(root, 'answer.ts', goodType);
      return [
        {
          type: 'tool_result',
          name: 'files',
          arguments: { action: 'edit' },
          result: '{"validation":{"status":"checked","complete":true,"diagnostics":[]}}',
        },
      ];
    },
    steps: [
      [call('read', 'files', { action: 'read', path: 'answer.ts' })],
      [
        call('edit', 'files', {
          action: 'edit',
          path: 'answer.ts',
          oldText: '"broken"',
          content: '42',
        }),
      ],
    ],
    async accept(root, events) {
      try {
        const code = await fs.readFile(path.join(root, 'answer.ts'), 'utf8');
        const validated = events.some((event) => {
          try {
            const result = JSON.parse(event.result);
            return (
              event.name === 'files' &&
              event.arguments?.action === 'edit' &&
              result.validation?.status === 'checked' &&
              result.validation.complete &&
              result.validation.diagnostics.length === 0
            );
          } catch {
            return false;
          }
        });
        return {
          passed:
            /export\s+const\s+answer\s*:\s*number\s*=\s*42\s*;?/.test(code) &&
            validated &&
            (await fs.readFile(path.join(root, 'tsconfig.json'), 'utf8')) ===
              '{"compilerOptions":{"strict":true,"noEmit":true}}',
          check: 'numeric API, automatic diagnostics clear and original configuration',
        };
      } catch {
        return { passed: false, check: 'type correction missing' };
      }
    },
  },
];
module.exports = { tasks };
