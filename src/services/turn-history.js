const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const same = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
const inside = (root, file) => { const relative = path.relative(root, file); return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
const depth = file => file.split(/[\\/]/).length;

function createTurnHistory(dataRoot, { maxBytes = 256 * 1024 * 1024, maxEntries = 20000, excludePaths = [] } = {}) {
  const directory = path.resolve(dataRoot, 'turn-history');
  const objects = path.join(directory, 'objects'), turns = path.join(directory, 'turns'), transactions = path.join(directory, 'transactions');
  const excluded = new Set(['achernar-state.json', 'achernar-state.json.tmp', 'provider-keys.json', 'provider-keys.json.tmp'].map(name => path.resolve(dataRoot, name)));
  const safeId = id => { if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id || '')) throw new Error('快照 ID 无效'); return id; };
  const objectPath = hash => { if (!/^[a-f0-9]{64}$/.test(hash || '')) throw new Error('文件快照损坏'); return path.join(objects, hash); };
  async function json(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = file + '.' + randomUUID() + '.tmp';
    try { await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await fs.rename(temp, file); }
    finally { await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async function entry(file, saveObject = false, budget) {
    let stat;
    try { stat = await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (stat.isSymbolicLink()) return { type: 'link', target: await fs.readlink(file) };
    if (stat.isDirectory()) return { type: 'directory' };
    if (!stat.isFile()) return { type: 'unsupported' };
    if (stat.size > maxBytes) throw new Error('文件超过快照容量：' + path.basename(file));
    if (budget && ((budget.bytes += stat.size) > maxBytes)) throw new Error('项目文件超过快照容量，本轮无法撤销');
    const bytes = await fs.readFile(file);
    const after = await fs.lstat(file);
    if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || stat.ino !== after.ino) throw new Error('文件正在被其他程序修改：' + path.basename(file));
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (saveObject) { await fs.mkdir(objects, { recursive: true }); await fs.writeFile(objectPath(hash), bytes, { flag: 'wx', mode: 0o600 }).catch(error => { if (error.code !== 'EEXIST') throw error; }); }
    return { type: 'file', hash, mode: stat.mode & 0o777 };
  }
  async function snapshot(project, scope) {
    const result = new Map(), budget = { bytes: 0 };
    async function visit(relative) {
      const file = path.join(project, relative);
      if (inside(directory, file) || excluded.has(file) || excludePaths.some(root => inside(root, file))) return;
      if (result.size >= maxEntries) throw new Error('项目条目超过快照容量，本轮无法撤销');
      const value = await entry(file, true, budget);
      if (!value) return;
      if (relative) result.set(relative, value);
      if (value.type === 'directory') for (const name of (await fs.readdir(file)).sort()) await visit(path.join(relative, name));
    }
    if (scope) {
      const file = path.resolve(project, scope.relative);
      if (!inside(project, file)) throw new Error('快照路径超出项目');
      const parents = [];
      let current = file;
      while (current !== project) {
        const value = await entry(current, false);
        // A linked path can affect its real target elsewhere inside the project.
        if (value?.type === 'link') return snapshot(project);
        if (current !== file) parents.push([path.relative(project, current), value]);
        current = path.dirname(current);
      }
      for (const [relative, value] of parents) if (value) result.set(relative, value);
      await visit(path.relative(project, file));
    } else await visit('');
    return result;
  }
  async function start({ sessionId, messageId, project }) {
    safeId(sessionId); safeId(messageId);
    project = await fs.realpath(project);
    const record = { sessionId, messageId, project, ready: false, changes: [], error: '' };
    const changed = new Map(); let queue = Promise.resolve();
    async function track(operation, scope) {
      let before;
      if (!record.error) try { before = await snapshot(project, scope); } catch (error) { record.error = error.message; }
      try { return await operation(); }
      finally {
        if (before) try {
          const after = await snapshot(project, scope);
          for (const relative of new Set([...before.keys(), ...after.keys()])) {
            const previous = before.get(relative) || null, next = after.get(relative) || null;
            if (same(previous, next)) continue;
            const existing = changed.get(relative);
            if (existing && !same(existing.after, previous)) record.error = '文件在操作间被再次修改，无法安全撤销：' + relative;
            changed.set(relative, { relative, before: existing ? existing.before : previous, after: next });
          }
          record.changes = [...changed.values()].filter(item => !same(item.before, item.after));
        } catch (error) { record.error = error.message; }
        await json(path.join(turns, messageId + '.json'), record).catch(error => { record.error = '快照保存失败：' + error.message; });
      }
    }
    return {
      track(operation, scope) { const pending = queue.then(() => track(operation, scope)); queue = pending.catch(() => {}); return pending; },
      async finish() {
        await queue; record.ready = true;
        if (record.changes.some(item => [item.before, item.after].some(value => value && !['file', 'directory'].includes(value.type)))) record.error ||= '本轮修改了符号链接或特殊文件，无法自动撤销';
        try { await json(path.join(turns, messageId + '.json'), record); } catch (error) { record.error = '快照保存失败：' + error.message; }
        return { available: !record.error, reason: record.error, files: record.changes.filter(item => item.before?.type === 'file' || item.after?.type === 'file').length };
      },
    };
  }
  async function compose(sessionId, messages) {
    const combined = new Map();
    for (const message of messages.filter(message => message.role === 'assistant')) {
      let record;
      try { record = JSON.parse(await fs.readFile(path.join(turns, safeId(message.id) + '.json'), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') throw new Error('此回复没有文件快照，无法安全撤销'); throw error; }
      if (record.sessionId !== sessionId || record.messageId !== message.id || !record.ready || record.error) throw new Error(record.error || '回复快照尚未完成');
      for (const item of record.changes) {
        const key = record.project + '\0' + item.relative, existing = combined.get(key);
        if (existing && !same(existing.after, item.before)) throw new Error('文件在对话间被修改，无法安全撤销：' + item.relative);
        combined.set(key, { ...item, project: record.project, before: existing ? existing.before : item.before });
      }
    }
    return [...combined.values()].filter(item => !same(item.before, item.after));
  }
  async function target(item) {
    const root = path.resolve(item.project), file = path.resolve(root, item.relative);
    if (file === root || !inside(root, file) || inside(directory, file) || excluded.has(file) || excludePaths.some(root => inside(root, file))) throw new Error('撤销路径无效');
    const rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await fs.realpath(root) !== root) throw new Error('项目路径已变化');
    let current = path.dirname(file);
    while (current !== root) {
      try { const stat = await fs.lstat(current); if (stat.isSymbolicLink()) throw new Error('撤销路径包含符号链接：' + item.relative); }
      catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
      current = path.dirname(current);
    }
    return file;
  }
  async function put(file, value) {
    if (!value) {
      const stat = await fs.lstat(file);
      if (stat.isDirectory()) await fs.rmdir(file); else await fs.unlink(file);
    } else if (value.type === 'directory') await fs.mkdir(file);
    else if (value.type === 'file') {
      const temp = path.join(path.dirname(file), '.achernar-restore-' + randomUUID());
      try { await fs.copyFile(objectPath(value.hash), temp); await fs.chmod(temp, value.mode); await fs.rename(temp, file); }
      finally { await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    } else throw new Error('符号链接或特殊文件不支持自动撤销');
  }
  async function transition(changes, from, to) {
    const plans = [];
    for (const item of changes) {
      const file = await target(item), source = item[from], destination = item[to];
      if ([source, destination].some(value => value && !['file', 'directory'].includes(value.type))) throw new Error('符号链接或特殊文件不支持自动撤销：' + item.relative);
      let actual; try { actual = await entry(file); } catch (error) { if (error.code === 'ENOTDIR' && !source) actual = null; else throw error; }
      if (!same(actual, source)) throw new Error('文件已被再次修改，未执行操作：' + item.relative);
      if (destination?.type === 'file') {
        const bytes = await fs.readFile(objectPath(destination.hash));
        if (createHash('sha256').update(bytes).digest('hex') !== destination.hash) throw new Error('文件快照损坏：' + item.relative);
      }
      plans.push({ ...item, file, source, destination });
    }
    // Refuse directory deletion if it would include files outside this history.
    const removed = new Set(plans.filter(item => item.source && (!item.destination || item.source.type !== item.destination.type)).map(item => item.file));
    for (const item of plans) if (item.source?.type === 'directory' && removed.has(item.file)) {
      for (const name of await fs.readdir(item.file)) if (!removed.has(path.join(item.file, name))) throw new Error('目录中有后续新增内容，未执行操作：' + item.relative);
    }
    const steps = [];
    for (const item of plans.filter(item => removed.has(item.file)).sort((a, b) => depth(b.file) - depth(a.file))) steps.push({ ...item, value: null, expected: item.source });
    for (const item of plans.filter(item => item.destination?.type === 'directory' && item.source?.type !== 'directory').sort((a, b) => depth(a.file) - depth(b.file))) steps.push({ ...item, value: item.destination, expected: null });
    for (const item of plans.filter(item => item.destination?.type === 'file')) steps.push({ ...item, value: item.destination, expected: removed.has(item.file) ? null : item.source });
    const completed = [];
    try {
      for (const step of steps) {
        await target(step);
        if (!same(await entry(step.file), step.expected)) throw new Error('文件在恢复期间被修改：' + step.relative);
        await put(step.file, step.value); completed.push(step);
      }
    } catch (error) {
      try {
        for (const step of completed.reverse()) {
          await target(step);
          if (!same(await entry(step.file), step.value)) throw new Error('恢复期间发生文件冲突：' + step.relative);
          await put(step.file, step.expected);
        }
      } catch (repairError) { repairError.recoveryRequired = true; throw repairError; }
      throw error;
    }
  }
  async function apply(changes, direction) {
    const id = randomUUID(), from = direction === 'undo' ? 'after' : 'before', to = direction === 'undo' ? 'before' : 'after';
    const file = path.join(transactions, id + '.json');
    await json(file, { id, changes, from, to });
    try { await transition(changes, from, to); }
    catch (error) { if (!error.recoveryRequired) await fs.unlink(file).catch(() => {}); throw error; }
    return { id, commit: () => fs.unlink(file), async rollback() { await transition(changes, to, from); await fs.unlink(file); } };
  }
  async function recover(committed) {
    let files; try { files = await fs.readdir(transactions); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const name of files.filter(name => name.endsWith('.json'))) {
      const file = path.join(transactions, name), record = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!committed(record.id)) {
        const repair = [];
        for (const item of record.changes) {
          let current; try { current = await entry(await target(item)); } catch (error) { if (error.code === 'ENOTDIR') current = null; else throw error; }
          const mayBeAbsent = !item[record.from] || !item[record.to] || item[record.from].type !== item[record.to].type;
          if (!same(current, item[record.from]) && !same(current, item[record.to]) && !(current === null && mayBeAbsent)) throw new Error('中断的撤销存在文件冲突，快照已保留：' + item.relative);
          if (!same(current, item[record.from])) repair.push({ ...item, current, original: item[record.from] });
        }
        await transition(repair, 'current', 'original');
      }
      await fs.unlink(file);
    }
  }
  return { start, compose, apply, recover };
}
module.exports = { createTurnHistory };
