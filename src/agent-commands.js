(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.agentCommands = value;
})(globalThis, () => {
  const builtins = [
    ['new', '新对话', '开始当前模式下的对话', 'message-square-plus', 'local'],
    ['plan', '先做计划', '只读分析，给出实施与验证步骤', 'list-checks', 'task'],
    ['review', '代码审查', '只读检查，报告问题与证据', 'scan-eye', 'task'],
    ['test', '运行验证', '寻找相关检查，执行并报告结果', 'flask-conical', 'task'],
    ['models', '模型管理', '配置服务商与模型', 'boxes', 'local'],
    ['skills', '插件与 Skills', '查看和管理可用扩展', 'blocks', 'local'],
    ['memory', '记忆', '查看已保存的记忆', 'brain', 'local'],
    ['pet', '桌面伙伴', '打开官方桌宠', 'orbit', 'local'],
    ['stop', '停止执行', '停止当前任务', 'square', 'local'],
    ['help', '指令说明', '查看键盘操作与调用方式', 'circle-help', 'local'],
  ].map(([id, label, description, icon, type]) => ({ id, command: '/' + id, label, description, icon, type, group: '常用指令' }));
  function catalog(extensions = []) {
    const used = new Set();
    return [...builtins, ...extensions.map(item => {
      const stem = String(item.name).toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'extension';
      const prefix = item.kind === 'skills' ? 'skill' : 'plugin';
      let command = `/${prefix}/${stem}`, suffix = 2;
      while (used.has(command)) command = `/${prefix}/${stem}-${suffix++}`;
      used.add(command);
      return { id: item.id, command, label: item.name, description: item.description || '按需读取使用说明', icon: item.kind === 'skills' ? 'book-open' : 'plug', group: item.kind === 'skills' ? 'Skills' : '插件', type: 'extension', source: item.status === 'adapter-required' ? '需适配' : item.source || '已安装' };
    })];
  }
  function parse(text, entries = builtins) {
    const match = /^\s*(\/\S+)(?:\s+([\s\S]*))?$/.exec(text || '');
    if (!match) return null;
    const entry = entries.find(item => item.command.toLowerCase() === match[1].toLowerCase());
    return entry ? { ...entry, argument: (match[2] || '').trim() } : null;
  }
  return { builtins, catalog, parse };
});
