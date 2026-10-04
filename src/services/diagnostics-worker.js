const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs'), path = require('node:path');

async function diagnose(project, file) {
  const target = await require('./project-path').projectPath(project, file);
  if ((await fs.promises.stat(target)).size > 1024 * 1024) throw new Error('File diagnostics accept at most 1 MB');
  if (/\.json$/i.test(target) && !/(?:^|[\\/])(?:tsconfig|jsconfig)(?:\.[^\\/]*)?\.json$/i.test(target)) {
    const text = await fs.promises.readFile(target, 'utf8'), diagnostics = [];
    try { JSON.parse(text.replace(/^\uFEFF/, '')); } catch (error) { diagnostics.push({ severity: 'error', message: error.message, code: 'INVALID_JSON' }); }
    return { path: file, diagnostics, complete: true, source: 'JSON parser' };
  }
  const ts = require('typescript');
  // Compiler API only: never execute project scripts, language plugins or emit files.
  let configFile, dir = path.dirname(target);
  const root = await fs.promises.realpath(project);
  while (true) {
    configFile = ['tsconfig.json', 'jsconfig.json'].map(name => path.join(dir, name)).find(name => fs.existsSync(name));
    if (configFile || dir === root || path.dirname(dir) === dir) break;
    dir = path.dirname(dir);
  }
  let options = { allowJs: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.Preserve }, configErrors = [];
  if (configFile) {
    // Warm workers re-diagnose many files per config; reparsing tsconfig on every
    // edit wastes time, so cache by config path and mtime.
    const mtime = fs.statSync(configFile).mtimeMs;
    const cache = (globalThis.__achernarConfigCache ||= new Map()).get(configFile);
    if (cache && cache.mtime === mtime) { ({ options, configErrors } = cache); }
    else {
      const read = ts.readConfigFile(configFile, ts.sys.readFile);
      if (read.error) configErrors.push(read.error);
      else {
        // Include only this edited file. Imported declarations are still resolved.
        const parsed = ts.parseJsonConfigFileContent({ ...read.config, files: [target], include: [], exclude: [] }, ts.sys, path.dirname(configFile));
        options = { ...options, ...parsed.options, noEmit: true, plugins: [] };
        configErrors = parsed.errors;
      }
      globalThis.__achernarConfigCache.set(configFile, { mtime, options, configErrors });
    }
  }
  const program = ts.createProgram([target], options), source = program.getSourceFile(target);
  if (!source) throw new Error('Compiler could not load edited file');
  const found = [...configErrors, ...program.getOptionsDiagnostics(), ...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)];
  return { path: file, complete: configErrors.length === 0, source: 'TypeScript compiler', truncated: found.length > 40,
    diagnostics: found.slice(0, 40).map(d => {
      const position = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : null;
      return { code: d.code, severity: ts.DiagnosticCategory[d.category].toLowerCase(), message: ts.flattenDiagnosticMessageText(d.messageText, '\n').slice(0, 1200),
        ...(position ? { line: position.line + 1, column: position.character + 1 } : {}) };
    }) };
}

if (workerData) {
  // One-shot mode: used through bounded-worker, answer workerData once and exit.
  diagnose(workerData.project, workerData.file).then(result => parentPort.postMessage(result), error => parentPort.postMessage({ error: error.message }));
} else {
  // Persistent mode: used through the diagnostics pool; answer tagged requests in
  // arrival order until the pool terminates this worker.
  let chain = Promise.resolve();
  parentPort.on('message', ({ id, project, file }) => {
    chain = chain.then(() => diagnose(project, file).then(
      result => parentPort.postMessage({ id, ...result }),
      error => parentPort.postMessage({ id, error: error.message })));
  });
}
