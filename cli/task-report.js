'use strict';
function createTaskReport() {
  const files = new Map(),
    commands = [];
  let tools = 0;
  return {
    event(event) {
      if (event.type === 'file_change')
        files.set((event.project || '') + ':' + event.path, {
          path: event.path,
          action: event.action,
        });
      if (event.type === 'tool_result') {
        tools++;
        if (event.name === 'terminal') {
          let result = event.result;
          try {
            if (typeof result === 'string') result = JSON.parse(result);
          } catch {}
          commands.push({
            command: event.arguments?.command || 'terminal',
            exitCode: result?.exitCode ?? null,
            failed: Boolean(event.failed),
            timedOut: Boolean(result?.timedOut),
            denied: Boolean(result?.denied),
          });
        }
      }
    },
    snapshot() {
      return { files: [...files.values()], commands: [...commands], tools };
    },
  };
}
module.exports = { createTaskReport };
