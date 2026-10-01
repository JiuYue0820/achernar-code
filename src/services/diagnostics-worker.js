const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs'), path = require('node:path');
(async () => {
  const file = await require('./project-path').projectPath(workerData.project, workerData.file);
  if ((await fs.promises.stat(file)).size > 1024 * 1024) throw new Error('File diagnostics accept at most 1 MB');
  if (/\.json$/i.test(file) && !/(?:^|[\\/])(?:tsconfig|jsconfig)(?:\.[^\\/]*)?\.json$/i.test(file)) {
    const text = await fs.promises.readFile(file, 'utf8'), diagnostics = [];
    try { JSON.parse(text.replace(/^\uFEFF/, '')); } catch (error) { diagnostics.push({ severity: 'error', message: error.message, code: 'INVALID_JSON' }); }
    return { path: workerData.file, diagnostics, complete: true, source: 'JSON parser' };
  }
  const ts = require('typescript');
  // Compiler API only: never execute project scripts, language plugins or emit files.
  let configFile, dir = path.dirname(file);
  const root = await fs.promises.realpath(workerData.project);
  while (true) {
    configFile = ['tsconfig.json', 'jsconfig.json'].map(name => path.join(dir, name)).find(name => fs.existsSync(name));
    if (configFile || dir === root || path.dirname(dir) === dir) break;
    dir = path.dirname(dir);
  }
  let options = { allowJs: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.Preserve }, configErrors = [];
  if (configFile) {
    const read = ts.readConfigFile(configFile, ts.sys.readFile);
    if (read.error) configErrors.push(read.error);
    else {
      // Include only this edited file. Imported declarations are still resolved.
      const parsed = ts.parseJsonConfigFileContent({ ...read.config, files: [file], include: [], exclude: [] }, ts.sys, path.dirname(configFile));
      options = { ...options, ...parsed.options, noEmit: true, plugins: [] };
      configErrors = parsed.errors;
    }
  }
  const program = ts.createProgram([file], options), source = program.getSourceFile(file);
  if (!source) throw new Error('Compiler could not load edited file');
  const found = [...configErrors, ...program.getOptionsDiagnostics(), ...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)];
  return { path: workerData.file, complete: configErrors.length === 0, source: 'TypeScript compiler', truncated: found.length > 40,
    diagnostics: found.slice(0, 40).map(d => {
      const position = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : null;
      return { code: d.code, severity: ts.DiagnosticCategory[d.category].toLowerCase(), message: ts.flattenDiagnosticMessageText(d.messageText, '\n').slice(0, 1200),
        ...(position ? { line: position.line + 1, column: position.character + 1 } : {}) };
    }) };
})().then(result => parentPort.postMessage(result), error => parentPort.postMessage({ error: error.message }));
